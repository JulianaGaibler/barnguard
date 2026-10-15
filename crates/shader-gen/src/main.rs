//! WGSL -> GLSL ES 300 + reflection sidecar, using the naga library directly.
//!
//! For each `<name>.wgsl` in the target directory this emits, alongside it:
//!   `<name>.gen.vert.glsl`  GLSL ES 300 vertex stage (entry point `vs_main`)
//!   `<name>.gen.frag.glsl`  GLSL ES 300 fragment stage (entry point `fs_main`)
//!   `<name>.reflect.json`   binding -> generated GLSL name map (ShaderReflection)
//!
//! GLSL ES 300 has no UBO/sampler binding qualifiers and naga mangles resource
//! names, so the WebGL2 backend needs the reflection to wire each binding
//! (`getUniformBlockIndex` / `getUniformLocation`). We read that mapping from
//! naga's `ReflectionInfo` (the authoritative source) rather than parsing the
//! generated text: `uniforms` gives each uniform block's GLSL block name and
//! `texture_mapping` gives each combined sampler's GLSL name, both keyed back to
//! a global whose `ResourceBinding` supplies the binding number. Attributes carry
//! explicit `layout(location=)`, so they need no reflection entry.
//!
//! GLSL is generated with the coordinate space kept as authored (no
//! `ADJUST_COORDINATE_SPACE`): the app's projection matrices own the Y-flip /
//! Z convention, not naga.
//!
//! Data tables: GLSL ES 300 has no storage buffers, so a WGSL declaration
//! `var<storage, read> NAME: array<vec4<f32>>` is rewritten before parsing for
//! the GLSL target only. The declaration becomes a `texture_2d<f32>` and each
//! `NAME[i]` becomes a `textureLoad` at texel `(i % 1024, i / 1024)`, which naga
//! emits as `texelFetch`. The WGSL on disk is what WebGPU runs, unchanged. The
//! WebGL2 backend stores the same table in an `RGBA32F` texture of that width
//! (`render/gfx/dataTable.ts`).
//!
//! Includes: a line `// #include "file.inc.wgsl"` is replaced by that file's
//! contents, resolved relative to the including file. A file is pasted at most
//! once per shader, so two includes that share a dependency don't define it
//! twice. Include files are named `*.inc.wgsl` and are never compiled on their
//! own. A shader that uses includes also gets `<name>.gen.wgsl`, the resolved
//! source, which is what WebGPU loads in place of the authored file.
//!
//! Usage: `shader-gen <dir> [name...]`. The directory is walked recursively.
//! With no names, every `*.wgsl` found is processed, otherwise only those whose
//! file stem matches a given name.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::process::exit;

use naga::back::glsl;
use naga::valid::{Capabilities, ValidationFlags, Validator};
use naga::ShaderStage;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct AttrEntry {
    location: u32,
    #[serde(rename = "glslName")]
    glsl_name: String,
}

#[derive(Serialize, Clone)]
struct BindEntry {
    binding: u32,
    #[serde(rename = "glslName")]
    glsl_name: String,
}

#[derive(Serialize)]
struct Reflection {
    /// Always empty: attributes carry explicit `layout(location=)` in the GLSL.
    attributes: Vec<AttrEntry>,
    #[serde(rename = "uniformBlocks")]
    uniform_blocks: Vec<BindEntry>,
    samplers: Vec<BindEntry>,
}

/// Translate one entry point to GLSL and collect its resource bindings.
fn write_stage(
    module: &naga::Module,
    info: &naga::valid::ModuleInfo,
    stage: ShaderStage,
    entry: &str,
) -> Result<(String, Vec<BindEntry>, Vec<BindEntry>), String> {
    let options = glsl::Options {
        version: glsl::Version::new_gles(300),
        // Keep the authored coordinate space. The app owns the Y-flip / Z range.
        writer_flags: glsl::WriterFlags::empty(),
        binding_map: glsl::BindingMap::default(),
        zero_initialize_workgroup_memory: false,
    };
    let pipeline_options = glsl::PipelineOptions {
        shader_stage: stage,
        entry_point: entry.to_string(),
        multiview: None,
    };

    let mut src = String::new();
    let mut writer = glsl::Writer::new(
        &mut src,
        module,
        info,
        &options,
        &pipeline_options,
        naga::proc::BoundsCheckPolicies::default(),
    )
    .map_err(|e| format!("writer init ({entry}): {e:?}"))?;
    let reflection = writer
        .write()
        .map_err(|e| format!("glsl write ({entry}): {e:?}"))?;

    let binding_of = |h: naga::Handle<naga::GlobalVariable>| -> Result<u32, String> {
        module.global_variables[h]
            .binding
            .as_ref()
            .map(|b| b.binding)
            .ok_or_else(|| format!("global in {entry} has no @binding"))
    };

    let mut blocks = Vec::new();
    for (handle, name) in reflection.uniforms.iter() {
        blocks.push(BindEntry {
            binding: binding_of(*handle)?,
            glsl_name: name.clone(),
        });
    }
    let mut samplers = Vec::new();
    for (glsl_name, mapping) in reflection.texture_mapping.iter() {
        samplers.push(BindEntry {
            binding: binding_of(mapping.texture)?,
            glsl_name: glsl_name.clone(),
        });
    }

    Ok((src, blocks, samplers))
}

/// Merge two stages' bindings, deduping identical `(binding, name)` pairs and
/// sorting by binding for stable output.
fn merge(mut a: Vec<BindEntry>, b: Vec<BindEntry>) -> Vec<BindEntry> {
    for e in b {
        if !a
            .iter()
            .any(|x| x.binding == e.binding && x.glsl_name == e.glsl_name)
        {
            a.push(e);
        }
    }
    a.sort_by(|x, y| {
        x.binding
            .cmp(&y.binding)
            .then(x.glsl_name.cmp(&y.glsl_name))
    });
    a
}

/// Collect every shader `*.wgsl` under `dir`, recursing into subdirectories.
/// Generated `*.gen.wgsl` and include-only `*.inc.wgsl` files are skipped.
fn collect_wgsl(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_dir() {
            collect_wgsl(&p, out)?;
        } else if file_name.ends_with(".wgsl")
            && !file_name.ends_with(".gen.wgsl")
            && !file_name.ends_with(INCLUDE_SUFFIX)
        {
            out.push(p);
        }
    }
    Ok(())
}

const INCLUDE_SUFFIX: &str = ".inc.wgsl";
const INCLUDE_DIRECTIVE: &str = "// #include \"";

/// `path` with `.` and `..` components folded away, without touching the file
/// system, so the same file reached two ways has one key.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Replace each include directive in `src` with the included file's contents,
/// recursively. `base` is the directory of the file `src` came from, `load`
/// reads a file, and `seen` holds every file already pasted into this shader.
fn resolve_includes(
    src: &str,
    base: &Path,
    load: &mut dyn FnMut(&Path) -> Result<String, String>,
    seen: &mut HashSet<PathBuf>,
) -> Result<String, String> {
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        let Some(rest) = line.trim_start().strip_prefix(INCLUDE_DIRECTIVE) else {
            out.push_str(line);
            out.push('\n');
            continue;
        };
        let name = rest
            .strip_suffix('"')
            .ok_or_else(|| format!("malformed include: {line}"))?;
        if !name.ends_with(INCLUDE_SUFFIX) {
            return Err(format!("include {name} is not a {INCLUDE_SUFFIX} file"));
        }
        let path = normalize(&base.join(name));
        if !seen.insert(path.clone()) {
            continue;
        }
        let included = load(&path)?;
        let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();
        out.push_str(&resolve_includes(&included, &dir, load, seen)?);
    }
    Ok(out)
}

/// Width in texels of a data table texture. Matches `DATA_TABLE_WIDTH` in
/// `render/gfx/dataTable.ts`.
const DATA_TABLE_WIDTH: u32 = 1024;

const TABLE_DECL: &str = "var<storage, read>";

/// Rewrite every `var<storage, read> NAME: array<vec4<f32>>;` table and its
/// indexed reads so the source parses for the GLSL ES target. Returns the
/// source unchanged when it declares no table.
fn lower_data_tables(src: &str) -> Result<String, String> {
    if !src.contains(TABLE_DECL) {
        return Ok(src.to_string());
    }
    let mut out = src.to_string();
    let mut names: Vec<String> = Vec::new();
    while let Some(at) = out.find(TABLE_DECL) {
        let rest = &out[at + TABLE_DECL.len()..];
        let semi = rest
            .find(';')
            .ok_or("data table declaration has no ';'")?;
        let decl = rest[..semi].trim();
        let (name, ty) = decl
            .split_once(':')
            .ok_or("data table declaration has no type")?;
        let ty: String = ty.split_whitespace().collect();
        if ty != "array<vec4<f32>>" {
            return Err(format!(
                "data table '{}' must be array<vec4<f32>>, found {}",
                name.trim(),
                ty
            ));
        }
        names.push(name.trim().to_string());
        let end = at + TABLE_DECL.len() + semi;
        out.replace_range(at..end, &format!("var {}: texture_2d<f32>", name.trim()));
    }
    for name in &names {
        out = rewrite_reads(&out, name)?;
    }
    out.push_str(&format!(
        "\nfn dt_texel(i: u32) -> vec2<i32> {{\n    return vec2<i32>(i32(i % {w}u), i32(i / {w}u));\n}}\n",
        w = DATA_TABLE_WIDTH
    ));
    Ok(out)
}

/// Replace each `name[expr]` read with a `textureLoad`, matching nested
/// brackets in `expr`.
fn rewrite_reads(src: &str, name: &str) -> Result<String, String> {
    let needle = format!("{name}[");
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    while let Some(rel) = src[i..].find(&needle) {
        let at = i + rel;
        let before_ok = src[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        out.push_str(&src[i..at]);
        if !before_ok {
            out.push_str(&needle);
            i = at + needle.len();
            continue;
        }
        let start = at + needle.len();
        let mut depth = 1;
        let mut end = start;
        for (off, c) in src[start..].char_indices() {
            match c {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start + off;
                        break;
                    }
                }
                _ => {}
            }
        }
        if depth != 0 {
            return Err(format!("unbalanced '[' in a read of data table '{name}'"));
        }
        let index = &src[start..end];
        out.push_str(&format!("textureLoad({name}, dt_texel(u32({index})), 0)"));
        i = end + 1;
    }
    out.push_str(&src[i..]);
    Ok(out)
}

fn generate(wgsl_path: &Path) -> Result<(), String> {
    let dir = wgsl_path.parent().unwrap_or(Path::new("."));
    let name = wgsl_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("bad path {}", wgsl_path.display()))?;
    let authored_src = std::fs::read_to_string(wgsl_path)
        .map_err(|e| format!("read {}: {e}", wgsl_path.display()))?;
    let mut read_include = |path: &Path| {
        std::fs::read_to_string(path).map_err(|e| format!("{name}.wgsl: include {}: {e}", path.display()))
    };
    let src = resolve_includes(&authored_src, dir, &mut read_include, &mut HashSet::new())?;
    let uses_includes = authored_src
        .lines()
        .any(|line| line.trim_start().starts_with(INCLUDE_DIRECTIVE));
    if uses_includes {
        let header = format!(
            "// Generated by shader-gen from {name}.wgsl and its includes. Do not edit.\n\n"
        );
        std::fs::write(dir.join(format!("{name}.gen.wgsl")), header + &src)
            .map_err(|e| format!("write {name}.gen.wgsl: {e}"))?;
    }

    // The WGSL as authored must be valid too, since WebGPU runs it. Parse it
    // first, then parse the table-lowered form for the GLSL stages.
    let authored = naga::front::wgsl::parse_str(&src)
        .map_err(|e| format!("{name}.wgsl parse error:\n{}", e.emit_to_string(&src)))?;
    let lowered = lower_data_tables(&src).map_err(|e| format!("{name}.wgsl: {e}"))?;
    let module = if lowered == src {
        authored
    } else {
        Validator::new(ValidationFlags::all(), Capabilities::all())
            .validate(&authored)
            .map_err(|e| format!("{name}.wgsl validation error: {e:?}"))?;
        naga::front::wgsl::parse_str(&lowered).map_err(|e| {
            format!(
                "{name}.wgsl parse error after table lowering:\n{}",
                e.emit_to_string(&lowered)
            )
        })?
    };

    // Compute-only WGSL (a `@compute` shader with no vs_main/fs_main) is a
    // WebGPU-only source: naga's GLSL-ES backend cannot emit compute, and the
    // WebGL2 path takes a fragment off-ramp instead. Skip generation rather than
    // fail the run, so `*.compute.wgsl` can live alongside the rendered shaders.
    let has_render_stage = module
        .entry_points
        .iter()
        .any(|ep| matches!(ep.stage, ShaderStage::Vertex | ShaderStage::Fragment));
    if !has_render_stage {
        println!("{name}: compute-only WGSL, skipping GLSL generation");
        return Ok(());
    }

    let mut validator = Validator::new(ValidationFlags::all(), Capabilities::all());
    let info = validator
        .validate(&module)
        .map_err(|e| format!("{name}.wgsl validation error: {e:?}"))?;

    let (vert, vblocks, vsamp) = write_stage(&module, &info, ShaderStage::Vertex, "vs_main")?;
    let (frag, fblocks, fsamp) = write_stage(&module, &info, ShaderStage::Fragment, "fs_main")?;

    std::fs::write(dir.join(format!("{name}.gen.vert.glsl")), &vert)
        .map_err(|e| format!("write vert: {e}"))?;
    std::fs::write(dir.join(format!("{name}.gen.frag.glsl")), &frag)
        .map_err(|e| format!("write frag: {e}"))?;

    let reflection = Reflection {
        attributes: Vec::new(),
        uniform_blocks: merge(vblocks, fblocks),
        samplers: merge(vsamp, fsamp),
    };
    let mut json = serde_json::to_string_pretty(&reflection)
        .map_err(|e| format!("serialize reflection: {e}"))?;
    json.push('\n');
    std::fs::write(dir.join(format!("{name}.reflect.json")), json)
        .map_err(|e| format!("write reflection: {e}"))?;

    println!(
        "{name}: {} block entries, {} sampler entries",
        reflection.uniform_blocks.len(),
        reflection.samplers.len(),
    );
    Ok(())
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = match args.next() {
        Some(d) => PathBuf::from(d),
        None => {
            eprintln!("usage: shader-gen <shader-dir> [name...]");
            exit(2);
        }
    };
    let only: Vec<String> = args.collect();

    let mut paths = Vec::new();
    if let Err(e) = collect_wgsl(&dir, &mut paths) {
        eprintln!("error: {e}");
        exit(1);
    }
    paths.retain(|p| {
        only.is_empty()
            || p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|stem| only.iter().any(|n| n == stem))
    });
    paths.sort();

    let mut failed = false;
    for path in &paths {
        if let Err(e) = generate(path) {
            eprintln!("error: {e}");
            failed = true;
        }
    }
    if failed {
        exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(files: &[(&str, &str)], entry: &str) -> Result<String, String> {
        let files: Vec<(PathBuf, String)> = files
            .iter()
            .map(|(path, text)| (PathBuf::from(path), text.to_string()))
            .collect();
        let mut load = |path: &Path| {
            files
                .iter()
                .find(|(p, _)| p == path)
                .map(|(_, text)| text.clone())
                .ok_or_else(|| format!("missing {}", path.display()))
        };
        let src = files.iter().find(|(p, _)| p == Path::new(entry)).unwrap().1.clone();
        resolve_includes(&src, Path::new("s"), &mut load, &mut HashSet::new())
    }

    #[test]
    fn pastes_an_include_in_place() {
        let out = resolve(
            &[
                ("s/a.wgsl", "fn a() {}\n// #include \"inc/b.inc.wgsl\"\nfn c() {}\n"),
                ("s/inc/b.inc.wgsl", "fn b() {}\n"),
            ],
            "s/a.wgsl",
        )
        .unwrap();
        assert_eq!(out, "fn a() {}\nfn b() {}\nfn c() {}\n");
    }

    #[test]
    fn pastes_a_shared_dependency_once() {
        let out = resolve(
            &[
                (
                    "s/a.wgsl",
                    "// #include \"inc/x.inc.wgsl\"\n// #include \"inc/y.inc.wgsl\"\n",
                ),
                ("s/inc/x.inc.wgsl", "// #include \"base.inc.wgsl\"\nfn x() {}\n"),
                ("s/inc/y.inc.wgsl", "// #include \"../inc/base.inc.wgsl\"\nfn y() {}\n"),
                ("s/inc/base.inc.wgsl", "fn base() {}\n"),
            ],
            "s/a.wgsl",
        )
        .unwrap();
        assert_eq!(out.matches("fn base()").count(), 1);
        assert!(out.find("fn base()").unwrap() < out.find("fn x()").unwrap());
        assert!(out.contains("fn y()"));
    }

    #[test]
    fn reports_a_missing_include() {
        let err = resolve(&[("s/a.wgsl", "// #include \"gone.inc.wgsl\"\n")], "s/a.wgsl")
            .unwrap_err();
        assert!(err.contains("gone.inc.wgsl"));
    }

    #[test]
    fn rejects_an_include_that_is_not_an_include_file() {
        let err = resolve(&[("s/a.wgsl", "// #include \"b.wgsl\"\n")], "s/a.wgsl").unwrap_err();
        assert!(err.contains(".inc.wgsl"));
    }

    #[test]
    fn stops_an_include_cycle() {
        let out = resolve(
            &[
                ("s/a.wgsl", "// #include \"x.inc.wgsl\"\n"),
                ("s/x.inc.wgsl", "// #include \"y.inc.wgsl\"\nfn x() {}\n"),
                ("s/y.inc.wgsl", "// #include \"x.inc.wgsl\"\nfn y() {}\n"),
            ],
            "s/a.wgsl",
        )
        .unwrap();
        assert_eq!(out, "fn y() {}\nfn x() {}\n");
    }

    #[test]
    fn leaves_a_source_without_tables_alone() {
        let src = "fn f() {}";
        assert_eq!(lower_data_tables(src).unwrap(), src);
    }

    #[test]
    fn rewrites_the_declaration_and_nested_reads() {
        let src = "@group(1) @binding(3) var<storage, read> params: array<vec4<f32>>;\n\
                   fn f(i: u32) -> vec4<f32> { return params[idx[i] + 1u] * 2.0; }\n";
        let out = lower_data_tables(src).unwrap();
        assert!(out.contains("var params: texture_2d<f32>;"));
        assert!(out.contains("textureLoad(params, dt_texel(u32(idx[i] + 1u)), 0) * 2.0"));
        assert!(out.contains("fn dt_texel"));
        assert!(!out.contains("var<storage"));
    }

    #[test]
    fn ignores_names_that_only_end_in_the_table_name() {
        let src = "var<storage, read> t: array<vec4<f32>>;\nfn f() { let a = not_t[0]; let b = t[1]; }\n";
        let out = lower_data_tables(src).unwrap();
        assert!(out.contains("not_t[0]"));
        assert!(out.contains("textureLoad(t, dt_texel(u32(1)), 0)"));
    }

    #[test]
    fn rejects_other_element_types() {
        let src = "var<storage, read> t: array<f32>;";
        assert!(lower_data_tables(src).is_err());
    }
}
