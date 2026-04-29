/**
 * Domain types — derived from Foundation Spec v1.2 Section 4 (database schema).
 *
 * These are the application-layer shapes. They map 1:1 to database rows but
 * use camelCase. The Supabase client layer (Phase 1) will handle the
 * snake_case ↔ camelCase translation.
 *
 * Adding a column to the database means adding a field here, in the same
 * commit, in the same PR. No exceptions.
 */

import type { RoleCode } from "./roles";

// ─────────────────────────────────────────────────────────────────────────────
// Auth & Access
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  phone: string | null;
  role: RoleCode;
  active: boolean;
  smsConsent: boolean;
  smsConsentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  type: "permanent" | "dark_kitchen";
  active: boolean;
  address: string | null;
  phone: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface UserLocation {
  userId: string;
  locationId: string;
  assignedAt: string;
  assignedBy: string | null;
}

export interface Session {
  id: string;
  userId: string;
  /** SHA-256 of the JWT carried in the session cookie. requireSession validates it
   *  alongside JWT signature/exp as defense against AUTH_JWT_SECRET leak forgery. */
  tokenHash: string;
  authMethod: "pin" | "password";
  stepUpUnlocked: boolean;
  stepUpUnlockedAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendors & Inventory
// ─────────────────────────────────────────────────────────────────────────────

export type VendorCategory =
  | "protein"
  | "produce"
  | "bread"
  | "dairy"
  | "dry"
  | "beverage"
  | "paper"
  | "cleaning"
  | "smallwares"
  | "other";

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  orderingEmail: string | null;
  orderingUrl: string | null;
  orderingDays: string | null;
  paymentTerms: string | null;
  accountNumber: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface VendorItem {
  id: string;
  vendorId: string;
  name: string;
  category: string | null;
  unit: string;
  unitSize: string | null;
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ParLevel {
  id: string;
  locationId: string;
  vendorItemId: string;
  parValue: number;
  /** NULL = all days; 0 = Sunday … 6 = Saturday */
  dayOfWeek: number | null;
  active: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checklists
// ─────────────────────────────────────────────────────────────────────────────

export type ChecklistType = "opening" | "prep" | "closing";

export interface ChecklistTemplate {
  id: string;
  locationId: string;
  type: ChecklistType;
  name: string;
  description: string | null;
  active: boolean;
  /** True for prep templates (locks on first submission); false for opening/closing. */
  singleSubmissionOnly: boolean;
  reminderTime: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  station: string | null;
  displayOrder: number;
  label: string;
  description: string | null;
  /** Decimal-aware: 3, 4, 5, 6, 6.5, 7, 8 are all valid. */
  minRoleLevel: number;
  required: boolean;
  expectsCount: boolean;
  expectsPhoto: boolean;
  vendorItemId: string | null;
  active: boolean;
}

export type ChecklistStatus = "open" | "confirmed" | "incomplete_confirmed";

export interface ChecklistInstance {
  id: string;
  templateId: string;
  locationId: string;
  date: string;
  shiftStartAt: string | null;
  status: ChecklistStatus;
  /** Confirmation fields are populated on PIN-confirm — there is no separate confirmations table. */
  confirmedAt: string | null;
  confirmedBy: string | null;
  createdAt: string;
}

export interface ChecklistCompletion {
  id: string;
  instanceId: string;
  templateItemId: string;
  completedBy: string;
  completedAt: string;
  countValue: number | null;
  photoId: string | null;
  notes: string | null;
  /** Non-null when a later completion superseded this one. */
  supersededAt: string | null;
  supersededBy: string | null;
}

export interface ChecklistSubmission {
  id: string;
  instanceId: string;
  submittedBy: string;
  submittedAt: string;
  completionIds: string[];
  isFinalConfirmation: boolean;
}

export interface ChecklistIncompleteReason {
  id: string;
  instanceId: string;
  templateItemId: string;
  reason: string;
  reportedBy: string;
  reportedAt: string;
}

export interface PrepListResolution {
  id: string;
  instanceId: string;
  vendorItemId: string;
  parTarget: number;
  onHand: number;
  /** max(parTarget - onHand, 0) */
  needed: number;
  resolvedAt: string;
  sourceOpeningCountAt: string | null;
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shift Overlay (renamed from daily_reports in v1.2)
// ─────────────────────────────────────────────────────────────────────────────

export type ShiftType = "open" | "lunch" | "close";

export interface ShiftOverlay {
  id: string;
  locationId: string;
  submittedBy: string;
  submittedByRole: RoleCode;
  date: string;
  shift: ShiftType;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;

  // Revenue
  totalSales: number | null;
  transactionCount: number | null;
  avgTicket: number | null;
  walkInSales: number | null;
  onlineSales: number | null;
  cateringSales: number | null;

  // Cash
  cashDrawerStart: number | null;
  cashDrawer: number | null;
  cashDeposit: number | null;
  cashOverShort: number | null;
  cashTips: number | null;

  // Voids/Comps/Waste
  voidCount: number;
  voidAmount: number;
  compCount: number;
  compAmount: number;
  compReason: string | null;
  wasteAmount: number;
  wasteReason: string | null;

  // Customer
  complaintCount: number;
  complaintType: string | null;

  // Delivery
  deliveryOrders: number;
  avgDeliveryTime: number | null;
  ddOrders: number;
  ueOrders: number;
  toastOrders: number;
  deliveryComplaints: number;
  driverHours: number | null;

  // Staffing
  calloutName: string | null;
  calloutReason: string | null;
  calloutCoveredBy: string | null;
  calloutCreatedOt: boolean;
  additionalCallouts: string | null;
  otEmployees: string | null;
  sentHomeEarly: string | null;

  // Context
  weather: string | null;
  externalEvent: string | null;
  eventDetail: string | null;

  // Vendor / cost
  vendorDeliveries: string | null;
  invoiceTotal: number | null;
  priceFlags: string | null;
  portionNotes: string | null;

  // People
  employeeHighlight: string | null;
  employeeConcern: string | null;
  negativeReviews: number;
  reviewResponseNeeded: boolean;
  scheduleAdherence: string | null;
  crossShiftNotes: string | null;
  followUpItems: string | null;

  // Strategic
  weeklyInventoryNotes: string | null;
  plNotes: string | null;
  maintenanceNeeded: string | null;
  strategicNotes: string | null;
  crossLocationNotes: string | null;

  // Executive
  ownerDirective: string | null;
  marketObservation: string | null;
  forecastNotes: string | null;

  // Journal
  shiftNotes: string | null;

  // Computed
  parFlags: HandoffFlag[];
  handoffFlags: HandoffFlag[];
}

export interface ShiftOverlayCorrection {
  id: string;
  originalOverlayId: string;
  submittedBy: string;
  submittedAt: string;
  fieldCorrections: Record<string, unknown>;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Written Reports & Announcements
// ─────────────────────────────────────────────────────────────────────────────

export interface WrittenReport {
  id: string;
  locationId: string | null;
  submittedBy: string;
  submittedByRole: RoleCode;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;
  category: string | null;
  title: string | null;
  body: string;
  visibilityMinLevel: number;
  relatedTable: string | null;
  relatedId: string | null;
}

export type AnnouncementPriority = "info" | "standard" | "urgent" | "critical";

export interface Announcement {
  id: string;
  locationId: string | null;
  postedBy: string;
  postedByRole: RoleCode;
  postedAt: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  requiresAcknowledgement: boolean;
  targetMinRoleLevel: number;
  targetMaxRoleLevel: number | null;
  expiresAt: string | null;
  active: boolean;
}

export interface AnnouncementAcknowledgement {
  id: string;
  announcementId: string;
  userId: string;
  acknowledgedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Training
// ─────────────────────────────────────────────────────────────────────────────

export type ProgressRating = "ahead" | "on_track" | "behind" | "concern";

export interface TrainingReport {
  id: string;
  locationId: string;
  submittedBy: string;
  submittedByRole: RoleCode;
  date: string;
  submittedAt: string;
  lastEditedAt: string | null;
  editCount: number;
  traineeName: string;
  traineeUserId: string | null;
  /** True when submitter is NOT the trainee's assigned trainer. */
  isObservational: boolean;
  skillsPracticed: string | null;
  hoursLogged: number | null;
  progressRating: ProgressRating | null;
  readinessNotes: string | null;
  trainerNotes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photos, Views, Audit
// ─────────────────────────────────────────────────────────────────────────────

export type PhotoCategory =
  | "quality_issue"
  | "cleanliness"
  | "equipment"
  | "inventory"
  | "staff_handoff"
  | "checklist_verification"
  | "other";

export interface ReportPhoto {
  id: string;
  relatedTable: string;
  relatedId: string;
  storagePath: string;
  category: PhotoCategory | null;
  caption: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface AuditLogEntry {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorRole: RoleCode | null;
  action: string;
  resourceTable: string;
  resourceId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  destructive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed / synthesis
// ─────────────────────────────────────────────────────────────────────────────

export interface HandoffFlag {
  severity: "info" | "warning" | "critical";
  category: string;
  message: string;
  source: { table: string; id: string; field?: string };
}
