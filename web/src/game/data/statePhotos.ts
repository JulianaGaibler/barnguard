import type { StateId } from './states'

import bwUrl from '@src/assets/state-images/BW.jpg?url'
import byUrl from '@src/assets/state-images/BY.jpg?url'
import beUrl from '@src/assets/state-images/BE.jpg?url'
import bbUrl from '@src/assets/state-images/BB.jpg?url'
import hbUrl from '@src/assets/state-images/HB.jpg?url'
import hhUrl from '@src/assets/state-images/HH.jpg?url'
import heUrl from '@src/assets/state-images/HE.jpg?url'
import mvUrl from '@src/assets/state-images/MV.jpg?url'
import niUrl from '@src/assets/state-images/NI.jpg?url'
import nwUrl from '@src/assets/state-images/NW.jpg?url'
import rpUrl from '@src/assets/state-images/RP.jpg?url'
import slUrl from '@src/assets/state-images/SL.jpg?url'
import snUrl from '@src/assets/state-images/SN.jpg?url'
import stUrl from '@src/assets/state-images/ST.jpg?url'
import shUrl from '@src/assets/state-images/SH.jpg?url'
import thUrl from '@src/assets/state-images/TH.jpg?url'

export interface StatePhoto {
  /** Vite-generated URL for the JPG asset. */
  url: string
  /** Landmark shown in the photo (German name, as authored). */
  location: string
  /** Photo credit, first-name / last-name or "Getty Images". */
  photographer: string
}

/**
 * One landscape photo per Bundesland, displayed as a `cover`-sized background
 * on the main confirm card at 50 % opacity so the state name + scores stay
 * readable on top. Attribution is rendered in small cream text below the card
 * row.
 *
 * Filenames mirror the canonical `StateId`. Assets ship as `?url` imports so
 * Vite handles cache-busting hashes.
 */
export const STATE_PHOTOS: Record<StateId, StatePhoto> = {
  BW: {
    url: bwUrl,
    location: 'Schloss Heidelberg',
    photographer: 'Sebastian Jacobsen',
  },
  BY: {
    url: byUrl,
    location: 'Schloss Neuschwanstein',
    photographer: 'Timo Volz',
  },
  BE: { url: beUrl, location: 'Reichstag', photographer: 'Yannic Kreß' },
  BB: {
    url: bbUrl,
    location: 'Schloss Sanssouci Potsdam',
    photographer: 'Dana Ward',
  },
  HB: { url: hbUrl, location: 'Weser, Bremen', photographer: 'Alain Rouiller' },
  HH: {
    url: hhUrl,
    location: 'Speicherstadt Hamburg',
    photographer: 'Claudio Testa',
  },
  HE: { url: heUrl, location: 'Frankfurter Skyline', photographer: 'Raja Sen' },
  MV: {
    url: mvUrl,
    location: 'Kreidefelsen Rügen',
    photographer: 'Joshua Kettle',
  },
  NI: {
    url: niUrl,
    location: 'Lüneburger Heide',
    photographer: 'Matthias Pens',
  },
  NW: { url: nwUrl, location: 'Kölner Dom', photographer: 'Getty Images' },
  RP: { url: rpUrl, location: 'Rhein, Bremm', photographer: 'Mika Baumeister' },
  SL: {
    url: slUrl,
    location: 'Saarschleife',
    photographer: 'Christopher Schaumloeffel',
  },
  SN: {
    url: snUrl,
    location: 'Frauenkirche, Dresden',
    photographer: 'Farschad Roschanipour',
  },
  ST: {
    url: stUrl,
    location: 'Schlosskirche Lutherstadt Wittenberg',
    photographer: 'Deny Hill',
  },
  SH: { url: shUrl, location: 'Lübeck', photographer: 'Stock Birken' },
  TH: { url: thUrl, location: 'Erfurt', photographer: 'Denisa-Elena Ficau' },
}
