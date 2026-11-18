// Item 9b fix round 4: the surfaces of the business report as the tests drive them, from a DTO. (Failing-first
// form: a passthrough to the surfaces as they stood at 5542af19. The fix commit turns this into the adapter that
// builds the page's view, lib/business-view-shared.ts, the only thing the page and the export receive.)
import { createElement, type ReactElement } from "react";
import type { BusinessReportDto } from "@/lib/business-report";
import * as Page from "@/components/reports-business/BusinessReport";
import * as Exp from "@/lib/report-export-shared";
import type { ExportRow, ShopRef } from "@/lib/report-export-shared";
import type { Language } from "@/lib/i18n/types";

type P = { dto: BusinessReportDto; language: Language };
export const BusinessOverview = (p: P): ReactElement => createElement(Page.BusinessOverview, p);
export const BusinessHours = (p: P): ReactElement => createElement(Page.BusinessHours, p);
export const BusinessChannels = (p: P): ReactElement => createElement(Page.BusinessChannels, p);
export const BusinessPeople = (p: P): ReactElement => createElement(Page.BusinessPeople, p);
export const BusinessCompare = (p: P & { previous: BusinessReportDto | null }): ReactElement => createElement(Page.BusinessCompare, p);

export const businessOverviewRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessOverviewRows(dto, shop);
export const businessHoursRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessHoursRows(dto, shop);
export const businessChannelRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessChannelRows(dto, shop);
export const businessPeopleRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessPeopleRows(dto, shop);
export const businessCompareRows = (dto: BusinessReportDto, previous: BusinessReportDto | null, shop: ShopRef): ExportRow[] => Exp.businessCompareRows(dto, previous, shop);
