// Item 9b fix round 4 (review ITEM9B-r4): the surfaces of the business report as the tests drive them, from a
// DTO. The page and the export receive ONLY the view (lib/business-view-shared.ts `businessView(dto)`: every figure
// sealed with its state), exactly as app/(authed)/reports/business/page.tsx and lib/report-export.ts build it;
// these adapters do the same, so a test can still shape a DTO (a labor state, a coverage) and read what a person
// or a file would get.
import { createElement, type ReactElement } from "react";
import type { BusinessReportDto } from "@/lib/business-report";
import { businessView } from "@/lib/business-view-shared";
import * as Page from "@/components/reports-business/BusinessReport";
import * as Exp from "@/lib/report-export-shared";
import type { ExportRow, ShopRef } from "@/lib/report-export-shared";
import type { Language } from "@/lib/i18n/types";

type P = { dto: BusinessReportDto; language: Language };
const v = (p: P) => ({ view: businessView(p.dto), language: p.language });
export const BusinessOverview = (p: P): ReactElement => createElement(Page.BusinessOverview, v(p));
export const BusinessHours = (p: P): ReactElement => createElement(Page.BusinessHours, v(p));
export const BusinessChannels = (p: P): ReactElement => createElement(Page.BusinessChannels, v(p));
export const BusinessPeople = (p: P): ReactElement => createElement(Page.BusinessPeople, v(p));
export const BusinessCompare = (p: P & { previous: BusinessReportDto | null }): ReactElement =>
  createElement(Page.BusinessCompare, { ...v(p), previous: p.previous ? businessView(p.previous) : null });

export const businessOverviewRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessOverviewRows(businessView(dto), shop);
export const businessHoursRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessHoursRows(businessView(dto), shop);
export const businessChannelRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessChannelRows(businessView(dto), shop);
export const businessPeopleRows = (dto: BusinessReportDto, shop: ShopRef): ExportRow[] => Exp.businessPeopleRows(businessView(dto), shop);
export const businessCompareRows = (dto: BusinessReportDto, previous: BusinessReportDto | null, shop: ShopRef): ExportRow[] =>
  Exp.businessCompareRows(businessView(dto), previous ? businessView(previous) : null, shop);
export const businessCoverageRow = (dto: BusinessReportDto, shop: ShopRef): ExportRow => Exp.businessCoverageRow(businessView(dto), shop);
export const businessCoverageNotice = (dto: BusinessReportDto) => Exp.businessCoverageNotice(businessView(dto));
export const businessHoursNotice = (dto: BusinessReportDto) => Exp.businessHoursNotice(businessView(dto));
