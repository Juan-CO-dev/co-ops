"use client";

/** One dispatcher: a section's data → its component, for both the home card and the section's own page. */
import type { ReactNode } from "react";
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { AttentionData, CateringData, FloorData, FoodSafetyData, HandoffData, InventoryData, PeopleData, SalesData, StationsData } from "@/lib/pulse/types";
import { FloorCard } from "@/components/pulse/floor/FloorCard";
import { AttentionList } from "@/components/pulse/sections/AttentionList";
import { CateringSection } from "@/components/pulse/sections/CateringSection";
import { FoodSafetySection } from "@/components/pulse/sections/FoodSafetySection";
import { HandoffSection } from "@/components/pulse/sections/HandoffSection";
import { InventorySection } from "@/components/pulse/sections/InventorySection";
import { PeopleSection } from "@/components/pulse/sections/PeopleSection";
import { SalesSection } from "@/components/pulse/sections/SalesSection";
import { StationsSection } from "@/components/pulse/sections/StationsSection";

export function SectionBody({ section, data, mode, locationId, date, refresh }: {
  section: PulseSection; data: unknown; mode: "card" | "detail"; locationId: string; date: string; viewerLevel: number; refresh: () => Promise<void>;
}): ReactNode {
  switch (section) {
    case "attention": return <AttentionList data={data as AttentionData} mode={mode} />;
    case "floor": return <FloorCard data={data as FloorData} mode={mode} onSaved={refresh} />;
    case "people": return <PeopleSection data={data as PeopleData} mode={mode} locationId={locationId} />;
    case "stations": return <StationsSection data={data as StationsData} mode={mode} locationId={locationId} />;
    case "sales": return <SalesSection data={data as SalesData} mode={mode} locationId={locationId} date={date} />;
    case "catering": return <CateringSection data={data as CateringData} mode={mode} />;
    case "inventory": return <InventorySection data={data as InventoryData} mode={mode} locationId={locationId} />;
    case "food_safety": return <FoodSafetySection data={data as FoodSafetyData} mode={mode} locationId={locationId} />;
    case "handoff": return <HandoffSection data={data as HandoffData} mode={mode} locationId={locationId} onChanged={refresh} />;
  }
}
