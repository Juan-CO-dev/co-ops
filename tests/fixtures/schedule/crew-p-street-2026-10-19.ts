import type { SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import type { PersonSettingsRow } from "@/lib/scheduling/people-input-shared";
import type { RoleCode } from "@/lib/roles";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { weekDays } from "@/lib/scheduling/time-shared";

// Sanitized snapshot copied once; no runtime dependency on untracked tmp data.
const snapshot: { source: string; budgetHoursWeek: number; structure: ScheduleStructure; people: Array<Omit<PersonSettingsRow, "userId" | "alsoAllowed" | "coverPositions" | "fullTime"> & { label: string; role: RoleCode; alsoAllowed: [] | null; coverPositions: string[] | null; fullTime: boolean | null }> } = {
  "source": "prod P Street settings, sanitized (labels = first names, no user ids/phones/wages), pulled 2026-10-22 after Quinn separated + Lucas on leave + close 8:30",
  "budgetHoursWeek": 350,
  "structure": {
    "crews": {
      "busy": {
        "close": {
          "walkHeads": 2,
          "prepDishHeads": 1,
          "registerHeads": 1
        },
        "waves": {
          "rush": {
            "atQ": 46,
            "heads": 4
          },
          "setup": {
            "atQ": 38,
            "heads": 3
          },
          "service": {
            "heads": 3
          }
        },
        "prepHeads": 1,
        "prepUntilQ": 64,
        "lineMinHeads": {
          "position-1": 1,
          "position-2": 1,
          "position-3": 0,
          "position-4": 0,
          "position-5": 1,
          "position-7": 1
        },
        "prepDishHeads": 1
      },
      "slow": {
        "close": {
          "walkHeads": 1,
          "prepDishHeads": 1,
          "registerHeads": 1
        },
        "waves": {
          "rush": {
            "atQ": 46,
            "heads": 2
          },
          "setup": {
            "atQ": 38,
            "heads": 2
          },
          "service": {
            "heads": 2
          }
        },
        "prepHeads": 0,
        "prepUntilQ": 60,
        "lineMinHeads": {
          "position-1": 1,
          "position-2": 1,
          "position-3": 0,
          "position-4": 0,
          "position-5": 1,
          "position-7": 1
        },
        "prepDishHeads": 1
      },
      "normal": {
        "close": {
          "walkHeads": 2,
          "prepDishHeads": 1,
          "registerHeads": 1
        },
        "waves": {
          "rush": {
            "atQ": 46,
            "heads": 3
          },
          "setup": {
            "atQ": 38,
            "heads": 2
          },
          "service": {
            "heads": 3
          }
        },
        "prepHeads": 1,
        "prepUntilQ": 60,
        "lineMinHeads": {
          "position-1": 1,
          "position-2": 1,
          "position-3": 0,
          "position-4": 0,
          "position-5": 1,
          "position-7": 1
        },
        "prepDishHeads": 1
      },
      "weekend": {
        "close": {
          "walkHeads": 2,
          "prepDishHeads": 1,
          "registerHeads": 1
        },
        "waves": {
          "rush": {
            "atQ": 46,
            "heads": 3
          },
          "setup": {
            "atQ": 38,
            "heads": 2
          },
          "service": {
            "heads": 3
          }
        },
        "prepHeads": 1,
        "prepUntilQ": 68,
        "lineMinHeads": {
          "position-1": 1,
          "position-2": 1,
          "position-3": 0,
          "position-4": 0,
          "position-5": 1,
          "position-7": 1
        },
        "prepDishHeads": 1
      }
    },
    "labor": {
      "basis": "total",
      "watch": 0.65,
      "strong": 0.8,
      "targetPct": 28,
      "budgetDeadbandH": 2
    },
    "limits": {
      "flexMaxQ": 12,
      "maxShiftH": 10.5,
      "overtimeH": 40,
      "gmMinimumH": 8,
      "agmMinimumH": 8,
      "segmentMinQ": 2,
      "flexMinimumQ": 12,
      "flexUsesPer2w": 1,
      "managerFloorH": 32,
      "minimumShiftQ": 16,
      "rushShiftMaxQ": 4,
      "salariedFlexH": 10,
      "salariedStayLonger": true,
      "salariedTargetWeekH": 40,
      "closingMinutesOverride": null
    },
    "roster": {
      "excludedRoles": [
        "cgs",
        "social_media_mgr"
      ]
    },
    "shopDay": {
      "outLatestQ": 82,
      "prepStartQ": 28,
      "outEarliestQ": 82,
      "serviceCloseQ": 80,
      "serviceStartQ": 42,
      "prepDishArrivalQ": 34
    },
    "version": 1,
    "catering": {
      "defaultEndQ": 52,
      "leadMinutes": 210,
      "minHeadcount": 30,
      "defaultStartQ": 34,
      "extraPrepDishHeads": 1
    },
    "dayTypes": {
      "busyAboveCents": 480000,
      "slowBelowCents": 400000,
      "weekendIsoDows": [
        6,
        7
      ]
    },
    "priority": [
      {
        "pair": [
          "position-8",
          "position-6"
        ],
        "primary": "position-8"
      },
      {
        "pair": [
          "position-2",
          "position-3"
        ],
        "primary": "position-2"
      },
      {
        "pair": [
          "position-1",
          "position-4"
        ],
        "primary": "position-1"
      }
    ],
    "positions": {
      "position-1": {
        "role": "walk_online",
        "openQ": 42,
        "trimQ": 68,
        "closeQ": 84,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-2": {
        "role": "register",
        "openQ": 42,
        "trimQ": 64,
        "closeQ": 84,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-3": {
        "role": "expo",
        "openQ": 46,
        "trimQ": 64,
        "closeQ": 80,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-4": {
        "role": "walk",
        "openQ": 42,
        "trimQ": 68,
        "closeQ": 84,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-5": {
        "role": "line_other",
        "openQ": 38,
        "trimQ": 56,
        "closeQ": 56,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-6": {
        "role": "prep",
        "openQ": 28,
        "trimQ": 60,
        "closeQ": 68,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-7": {
        "role": "line_other",
        "openQ": 38,
        "trimQ": 62,
        "closeQ": 62,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer",
          "key_holder",
          "shift_lead",
          "agm",
          "gm",
          "moo",
          "owner"
        ]
      },
      "position-8": {
        "role": "prep_dish",
        "openQ": 28,
        "trimQ": 68,
        "closeQ": 84,
        "headsAfter": 1,
        "headsBefore": 1,
        "allowedRoles": [
          "trainee",
          "employee",
          "trainer"
        ]
      }
    },
    "leadership": {
      "modRequired": true,
      "closingRoles": [
        "key_holder",
        "shift_lead",
        "agm",
        "gm",
        "moo",
        "owner"
      ],
      "leaderDefaults": {
        "gm": "opens",
        "agm": "opens",
        "moo": "mix",
        "owner": "mix",
        "key_holder": "closes",
        "shift_lead": "opens"
      },
      "keyHolderModAfterQ": 28
    }
  },
  "people": [
    {
      "label": "Akia",
      "role": "employee",
      "workType": "foh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-7",
        "position-1"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Ammar",
      "role": "key_holder",
      "workType": "foh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-7",
        "position-1",
        "position-2"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Cristian",
      "role": "moo",
      "workType": null,
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-2",
        "position-3"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Daniela",
      "role": "employee",
      "workType": "boh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-8",
        "position-6"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": {
        "1": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "2": {
          "mode": "off"
        },
        "3": {
          "mode": "off"
        },
        "4": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "5": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "6": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "7": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        }
      }
    },
    {
      "label": "Henry",
      "role": "employee",
      "workType": "foh",
      "alsoAllowed": [],
      "leaderSetting": "opens",
      "coverPositions": [
        "position-5",
        "position-6",
        "position-8"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": true,
      "fullTimeMinH": 40,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Islam",
      "role": "shift_lead",
      "workType": "foh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-2",
        "position-3",
        "position-7"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "J",
      "role": "gm",
      "workType": null,
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-2",
        "position-3"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Josselin",
      "role": "employee",
      "workType": "boh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-8",
        "position-6"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": {
        "1": {
          "toQ": 96,
          "mode": "if_needed",
          "fromQ": 64
        },
        "2": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "3": {
          "toQ": 96,
          "mode": "works",
          "fromQ": 64
        },
        "4": {
          "toQ": 96,
          "mode": "if_needed",
          "fromQ": 64
        },
        "5": {
          "toQ": 96,
          "mode": "if_needed",
          "fromQ": 64
        },
        "6": {
          "toQ": 96,
          "mode": "if_needed",
          "fromQ": 64
        },
        "7": {
          "toQ": 96,
          "mode": "if_needed",
          "fromQ": 64
        }
      }
    },
    {
      "label": "Juan",
      "role": "cgs",
      "workType": null,
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-2",
        "position-3"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": "key_holder",
      "availability": null
    },
    {
      "label": "Keith",
      "role": "catering_mgr",
      "workType": null,
      "alsoAllowed": null,
      "leaderSetting": null,
      "coverPositions": null,
      "softMinH": null,
      "softMaxH": null,
      "fullTime": null,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Olivia",
      "role": "employee",
      "workType": "foh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-1",
        "position-5"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Pete",
      "role": "owner",
      "workType": null,
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-2",
        "position-3"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": null
    },
    {
      "label": "Santos",
      "role": "employee",
      "workType": "boh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-6",
        "position-8"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": {
        "1": {
          "mode": "off"
        },
        "2": {
          "mode": "off"
        },
        "3": {
          "mode": "off"
        },
        "4": {
          "mode": "off"
        },
        "5": {
          "mode": "if_needed"
        },
        "6": {
          "mode": "works"
        },
        "7": {
          "mode": "works"
        }
      }
    },
    {
      "label": "Tio",
      "role": "employee",
      "workType": "boh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-8",
        "position-6"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": {
        "1": {
          "mode": "works"
        },
        "2": {
          "mode": "works"
        },
        "3": {
          "mode": "works"
        },
        "4": {
          "mode": "works"
        },
        "5": {
          "mode": "works"
        },
        "6": {
          "mode": "off"
        },
        "7": {
          "mode": "off"
        }
      }
    },
    {
      "label": "Veronica",
      "role": "employee",
      "workType": "boh",
      "alsoAllowed": [],
      "leaderSetting": null,
      "coverPositions": [
        "position-8",
        "position-6"
      ],
      "softMinH": null,
      "softMaxH": null,
      "fullTime": false,
      "fullTimeMinH": null,
      "rosterInclude": null,
      "worksAs": null,
      "availability": {
        "1": {
          "mode": "off"
        },
        "2": {
          "mode": "off"
        },
        "3": {
          "mode": "off"
        },
        "4": {
          "mode": "off"
        },
        "5": {
          "mode": "if_needed"
        },
        "6": {
          "mode": "works"
        },
        "7": {
          "mode": "works"
        }
      }
    }
  ]
};

export const WEEK = "2026-10-19";
export const DATES = weekDays(WEEK);
export const personId = (name: string) => `person-${name.toLowerCase()}`;
export function acceptanceInputs(): SchedulingInputs {
  const structure = structuredClone(snapshot.structure);
  structure.engine = "crew";
  structure.shiftTypes = [
    { id: "opener", name: "Opener", fromQ: 30, toQ: 64, startFlexQ: 4, minLengthQ: 24, headcount: { slow: 3, normal: 3, busy: 3, weekend: 3 }, stations: ["position-6", "position-5", "position-8"], countsTowardMod: true },
    { id: "mid", name: "Mid", fromQ: 40, toQ: 82, startFlexQ: 4, minLengthQ: 20, headcount: { slow: 3, normal: 3, busy: 4, weekend: 4 }, stations: ["position-2", "position-3", "position-7", "position-1", "position-4"], countsTowardMod: true },
    { id: "pm", name: "PM closer", fromQ: 64, toQ: 82, startFlexQ: 0, minLengthQ: 16, headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: ["position-8", "position-6"], countsTowardMod: false },
  ];
  const usual: Record<string, PersonSettingsRow["usualShift"]> = {
    J: { typeId: "opener", fromQ: 32, toQ: 64 }, Henry: { typeId: "opener", fromQ: 30, toQ: 64 },
    Tio: { typeId: "opener", fromQ: 32, toQ: 64 }, Santos: { typeId: "opener" }, Veronica: { typeId: "opener" },
    Islam: { typeId: "mid" }, Olivia: { typeId: "mid" }, Akia: { typeId: "mid" }, Ammar: { typeId: "mid" }, Juan: { typeId: "mid" },
    Daniela: { typeId: "pm" }, Josselin: { typeId: "pm" },
  };
  const settings = snapshot.people.map((p): PersonSettingsRow => ({
    userId: personId(p.label), workType: p.workType as PersonSettingsRow["workType"], alsoAllowed: [],
    leaderSetting: p.leaderSetting as PersonSettingsRow["leaderSetting"], coverPositions: p.coverPositions ?? [],
    softMinH: p.softMinH, softMaxH: p.softMaxH, fullTime: p.fullTime ?? false, fullTimeMinH: p.fullTimeMinH,
    rosterInclude: p.rosterInclude, worksAs: p.worksAs as PersonSettingsRow["worksAs"],
    availability: structuredClone(p.availability) as PersonSettingsRow["availability"], usualShift: usual[p.label] ?? null,
  }));
  // R14 supplies these usual days; snapshot null availability cannot express them.
  for (const [name, days] of [["J", [1, 2, 3, 4, 7]], ["Henry", [2, 3, 4, 5, 6]]] as const) {
    const availability: NonNullable<PersonSettingsRow["availability"]> = {
      1: { mode: "off" }, 2: { mode: "off" }, 3: { mode: "off" }, 4: { mode: "off" },
      5: { mode: "off" }, 6: { mode: "off" }, 7: { mode: "off" },
    };
    for (const day of days) availability[day] = { mode: "works" };
    settings.find((p) => p.userId === personId(name))!.availability = availability;
  }
  // Explicit synthetic negative controls: excluded employment wins even over a usual shift.
  for (const name of ["Quinn", "Lucas"]) settings.push({ ...structuredClone(settings[0]!), userId: personId(name) });
  const members = snapshot.people.map((p) => ({ userId: personId(p.label), name: p.label, role: p.role as RoleCode, memberSince: null }));
  for (const name of ["Quinn", "Lucas"]) members.push({ userId: personId(name), name, role: "employee", memberSince: null });
  return {
    locationId: "shop-p-street", asOf: WEEK,
    structure: { id: "structure-acceptance", structure, source: "saved" }, structuresById: { "structure-acceptance": structure },
    shopSettings: { enabled: true, estimatedHourlyCents: null, estimatedSalariedWeeklyCents: null, agmAccess: "read" },
    members, personSettings: settings, employmentExcluded: [personId("Quinn"), personId("Lucas")],
    skills: { locationId: "shop-p-street", asOf: WEEK, tunablesVersion: "synthetic-empty", positions: [], people: [] },
    skillBands: { building: 0.65, strong: 0.8 },
    budget: { entries: [{ id: "budget", scope: "week", weekStart: WEEK, month: null, hours: snapshot.budgetHoursWeek, source: "manager", suggestionDigest: null, apportionedBy: "even", createdAt: "2026-10-18T12:00:00Z" }], rows: DATES.map((date) => ({ entryId: "budget", date, hours: 50 })) },
    dayTypes: [{ id: "friday-busy", date: DATES[4]!, dayType: "busy", createdAt: "2026-10-18T12:00:00Z" }],
    pins: [], weeks: {}, demand: { kind: "no_history", days: DATES.map((date) => ({ kind: "no_history", date, weeksAhead: 0, catering: [] })) },
    catering: [], punches: [], closing: { minutes: null, samples: 0, basis: "insufficient" },
    wages: { byUserCents: {}, source: "none" }, overtimeH: null, keptBudgetDigests: [],
  };
}
