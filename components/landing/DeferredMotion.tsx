"use client";
// Keep one server-rendered poster mounted through hydration and playback.
// HeroMotion defers the media source, rather than replacing this tree.
export {HeroMotion as DeferredMotion} from './HeroMotion';
