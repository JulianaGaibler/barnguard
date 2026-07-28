//! WGSL → GLSL ES 300 + reflection sidecar, using the naga library directly.
//!
//! For each `<name>.wgsl` in the target directory this emits, alongside it:
//!   `<name>.gen.vert.glsl`  GLSL ES 300 vertex stage (entry point `vs_main`)
//!   `<name>.gen.frag.glsl`  GLSL ES 300 fragment stage (entry point `fs_main`)
//!   `<name>.reflect.json`   binding → generated GLSL name map (ShaderReflection)
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
//! Usage: `shader-gen <dir> [name...]`. The directory is walked recursively.
//! With no names, every `*.wgsl` found is processed, otherwise only those whose
//! file stem matches a given name.

use std::path::{Path, PathBuf};
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

/// Collect every `*.wgsl` (excluding generated `*.gen.*`) under `dir`, recursing
/// into subdirectories.
fn collect_wgsl(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_wgsl(&p, out)?;
        } else if p.extension().and_then(|e| e.to_str()) == Some("wgsl") {
            out.push(p);
        }
    }
    Ok(())
}

fn generate(wgsl_path: &Path) -> Result<(), String> {
    let dir = wgsl_path.parent().unwrap_or(Path::new("."));
    let name = wgsl_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("bad path {}", wgsl_path.display()))?;
    let src = std::fs::read_to_string(wgsl_path)
        .map_err(|e| format!("read {}: {e}", wgsl_path.display()))?;

    let module = naga::front::wgsl::parse_str(&src)
        .map_err(|e| format!("{name}.wgsl parse error:\n{}", e.emit_to_string(&src)))?;
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
