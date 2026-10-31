/**
 * Deterministic CivicFlow demo workspace generator.
 *
 * The JSON it writes is the single source of truth for demo data. Rust seeds
 * SQLite from the same file and the browser preview reads it directly, so both
 * runtimes show identical records. The demo clock is fixed so screenshots,
 * tests and the demo rehearsal never drift.
 */
import fs from "node:fs/promises";

const DEMO_NOW = "2026-10-13T07:45:00-04:00";
const ORG = {
  id: "org-rivergate-kitchen",
  name: "Rivergate Kitchen",
  initials: "RK",
  mission:
    "Feed hunger and build stronger communities by connecting people, food, and resources across the neighborhood.",
  city: "Buffalo",
  state: "NY",
  address: "214 Rivergate Avenue, Buffalo, NY 14206",
  website: "rivergate.example",
  email: "volunteer@rivergate.example",
  timezone: "America/New_York",
};

const COORDINATOR = {
  id: "user-praket",
  name: "Praket Gauri",
  firstName: "Praket",
  initials: "PG",
  role: "Coordinator",
  email: "praket@rivergate.example",
  tone: "amber",
};

const MAYA = {
  id: "vol-maya",
  name: "Maya Chen",
  firstName: "Maya",
  initials: "MC",
  role: "Volunteer",
  email: "maya.chen@example.org",
  phone: "(716) 555-0142",
  joinedAt: "2025-03-04",
  birthdate: "2001-04-12",
  status: "active",
  tone: "violet",
  skills: ["Spanish", "Food handling", "Tutoring"],
  languages: ["English", "Spanish"],
  causes: ["food", "education", "community"],
  hoursVerified: 84.5,
  attendanceRate: 94,
  eventsCompleted: 12,
  interests: "Food security, education, and community service",
  availability: [
    { day: "mon", period: "evening" },
    { day: "tue", period: "evening" },
    { day: "thu", period: "evening" },
    { day: "sat", period: "morning" },
    { day: "sat", period: "afternoon" },
  ],
};

const FIRST = [
  "Jordan",
  "Ava",
  "Theo",
  "Sophia",
  "Liam",
  "Emma",
  "Noah",
  "Priya",
  "Mateo",
  "Grace",
  "Ethan",
  "Isabel",
  "Marcus",
  "Nina",
  "Owen",
  "Leila",
  "Caleb",
  "Zoe",
  "Hannah",
  "Diego",
  "Amara",
  "Felix",
  "Ruby",
  "Jonah",
  "Elena",
  "Sam",
  "Tara",
  "Victor",
  "Maya",
  "Andre",
  "Clara",
  "Rafael",
  "Jasmine",
  "Nathan",
  "Iris",
  "Omar",
  "Tessa",
  "Lucas",
  "Aisha",
  "Ben",
  "Camila",
  "Darius",
  "Eve",
  "Finn",
  "Gloria",
  "Hugo",
  "Imani",
  "Jesse",
  "Kira",
  "Leo",
  "Mina",
  "Nico",
  "Olive",
  "Pablo",
  "Quinn",
  "Rosa",
  "Soren",
];
const LAST = [
  "Lee",
  "Patel",
  "Martin",
  "Ramirez",
  "Carter",
  "Wilson",
  "Park",
  "Shah",
  "Alvarez",
  "Kim",
  "Brooks",
  "Nguyen",
  "Reed",
  "Okafor",
  "Bennett",
  "Haddad",
  "Foster",
  "Morales",
  "Lindqvist",
  "Ortiz",
  "Boateng",
  "Novak",
  "Silva",
  "Weber",
  "Rossi",
  "Kaur",
  "Chen",
  "Mensah",
  "Ivanov",
  "Duarte",
];
const TONES = ["violet", "teal", "coral", "amber", "cobalt", "green", "rose", "cyan"];
const SKILLS = [
  "Spanish",
  "Driver",
  "Food handling",
  "Tutoring",
  "CPR",
  "Event setup",
  "Gardening",
  "Customer service",
  "Leadership",
  "Technology",
];
const CAUSES = ["food", "education", "environment", "health", "community", "animals"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const PERIODS = ["morning", "afternoon", "evening"];

/** Small deterministic PRNG so the seed is reproducible. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const rand = rng(20261013);
const pick = (list) => list[Math.floor(rand() * list.length)];

// Licensed portrait photography for the volunteers AutoRoster surfaces first.
// Everyone else keeps the initials avatar, so the data stays honest.
const PORTRAITS = {
  "vol-026": "/media/volunteers/olive-carter.jpg",
  "vol-042": "/media/volunteers/rafael-martin.jpg",
  "vol-018": "/media/volunteers/jasmine-bennett.jpg",
  "vol-058": "/media/volunteers/diego-weber.jpg",
  "vol-061": "/media/volunteers/nico-carter.jpg",
  "vol-076": "/media/volunteers/gloria-weber.jpg",
};

const volunteers = [];
const usedNames = new Set([MAYA.name]);
while (volunteers.length < 81) {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  if (usedNames.has(name)) continue;
  usedNames.add(name);
  const idx = volunteers.length + 2;
  const id = `vol-${String(idx).padStart(3, "0")}`;
  const skills = [...new Set([pick(SKILLS), pick(SKILLS), pick(SKILLS)])];
  const causes = [...new Set([pick(CAUSES), pick(CAUSES)])];
  const availability = DAYS.filter(() => rand() > 0.55).flatMap((day) =>
    PERIODS.filter(() => rand() > 0.45).map((period) => ({ day, period })),
  );
  const birthYear = idx % 29 === 0 ? 2011 : 1958 + ((idx * 7) % 48);
  const birthMonth = 1 + (idx % 12);
  const birthDay = 1 + ((idx * 3) % 27);
  volunteers.push({
    id,
    name,
    firstName: name.split(" ")[0],
    initials: name
      .split(" ")
      .map((part) => part[0])
      .join(""),
    photo: PORTRAITS[id],
    role: "Volunteer",
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`,
    phone: `(716) 555-${String(1000 + idx).slice(-4)}`,
    joinedAt: `202${3 + (idx % 3)}-0${1 + (idx % 9)}-1${idx % 9}`,
    birthdate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
    status: idx % 41 === 0 ? "inactive" : idx % 27 === 0 ? "onboarding" : "active",
    tone: TONES[idx % TONES.length],
    skills,
    languages: skills.includes("Spanish") ? ["English", "Spanish"] : ["English"],
    causes,
    hoursVerified: Math.round((4 + rand() * 120) * 10) / 10,
    attendanceRate: 78 + Math.floor(rand() * 22),
    eventsCompleted: 1 + Math.floor(rand() * 28),
    availability: availability.length ? availability : [{ day: "sat", period: "morning" }],
    interests: `Cares about ${causes.join(" and ")}.`,
  });
}

const allVolunteers = [{ ...MAYA, eventsCompleted: 12, hoursVerified: 18.5 }, ...volunteers];

const CREDENTIAL_FOR_SKILL = {
  Driver: "Safe driver clearance",
  "Food handling": "Food safety handler",
  Tutoring: "Tutor certification",
  CPR: "CPR / AED",
  Gardening: "Garden tool safety",
  Leadership: "Volunteer team lead",
};
const credentials = allVolunteers.flatMap((volunteer, volunteerIndex) =>
  volunteer.skills
    .filter((skill) => CREDENTIAL_FOR_SKILL[skill])
    .map((skill, skillIndex) => {
      const offsetDays = ((volunteerIndex * 37 + skillIndex * 13) % 520) - 80;
      const expires = new Date(new Date(DEMO_NOW).getTime() + offsetDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const issued = new Date(new Date(DEMO_NOW).getTime() + (offsetDays - 365) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return {
        id: `cred-${volunteer.id}-${skill.toLowerCase().replace(/[^a-z]+/g, "-")}`,
        volunteerId: volunteer.id,
        name: CREDENTIAL_FOR_SKILL[skill],
        identifier: `CF-${String(2200 + volunteerIndex * 3 + skillIndex)}`,
        issuedAt: issued,
        validFrom: issued,
        validThrough: expires,
        verifiedAt: issued,
        verifiedBy: "Alicia Rivera",
        notes: skill === "Driver" ? "Motor vehicle record checked" : null,
      };
    }),
);

const opportunities = [
  {
    id: "opp-food",
    slug: "community-food-distribution",
    title: "Community Food Distribution",
    cause: "food",
    organization: ORG.name,
    image: "/media/opp-food-distribution.jpg",
    imageAlt: "Volunteers in white shirts packing food aid boxes beside a van",
    description:
      "Pack and distribute nutritious food boxes to families across the neighborhood. Volunteers will assemble boxes, greet neighbors, and help load groceries into cars at our Rivergate Avenue kitchen.",
    address: "214 Rivergate Avenue, Buffalo, NY 14206",
    distanceMiles: 1.2,
    coordinator: "Alicia Rivera",
    capacity: 16,
    duration: "9:00 AM – 12:00 PM",
    training: ["Food safety basics", "Warehouse orientation"],
    requirements: ["Closed-toe shoes", "Able to lift 20 lb"],
    impactMetric: "Meals packed",
  },
  {
    id: "opp-garden",
    slug: "community-garden-restoration",
    title: "Community Garden Restoration",
    cause: "environment",
    organization: "Rivergate Greenway",
    image: "/media/opp-community-garden.jpg",
    imageAlt: "Volunteer tending raised garden beds in a community garden",
    description:
      "Restore raised beds, plant fall cover crops, and prepare the garden for winter. No gardening experience needed — we will teach you everything on site.",
    address: "48 Garden Row, Buffalo, NY 14213",
    distanceMiles: 2.4,
    coordinator: "Sam Ortega",
    capacity: 12,
    duration: "1:00 PM – 3:30 PM",
    training: ["Tool safety"],
    requirements: ["Weather-ready clothing"],
    impactMetric: "Garden beds restored",
  },
  {
    id: "opp-library",
    slug: "library-tutoring",
    title: "Library Tutoring",
    cause: "education",
    organization: "Rivergate Public Library",
    image: "/media/opp-library-tutoring.jpg",
    imageAlt: "Tutor reading a picture book with a young student in a library",
    description:
      "Support K–5 learners with reading and math in a calm, welcoming library space. Tutors commit to one afternoon a week and follow a ready-made activity plan.",
    address: "7 Library Lane, Buffalo, NY 14203",
    distanceMiles: 0.8,
    coordinator: "Ruth Kim",
    capacity: 10,
    duration: "2:00 PM – 4:00 PM",
    training: ["Tutor orientation", "Youth safety"],
    requirements: ["Background check", "17 or older"],
    impactMetric: "Tutoring sessions",
  },
  {
    id: "opp-senior",
    slug: "senior-meal-delivery",
    title: "Senior Meal Delivery",
    cause: "health",
    organization: "Rivergate Meals",
    image: "/media/opp-senior-meals.jpg",
    imageAlt: "Volunteer helping an older neighbor from a car",
    description:
      "Deliver warm meals and a friendly check-in to homebound neighbors. Routes take about ninety minutes and include a brief wellness check.",
    address: "Rivergate, Buffalo, NY 14213",
    distanceMiles: 3.1,
    coordinator: "Dana Whitfield",
    capacity: 8,
    duration: "10:00 AM – 12:00 PM",
    training: ["Food safety", "Wellness check-in"],
    requirements: ["Driver license", "Reliable vehicle"],
    impactMetric: "Meals delivered",
  },
  {
    id: "opp-park",
    slug: "park-cleanup-beautification",
    title: "Park Cleanup & Beautification",
    cause: "environment",
    organization: "Rivergate Parks Trust",
    image: "/media/opp-park-cleanup.jpg",
    imageAlt: "Volunteers collecting litter in a green park",
    description:
      "Remove litter, refresh planting beds, and repaint picnic tables along the waterfront. Gloves, grabbers, and refreshments are provided.",
    address: "Rivergate Park, Buffalo, NY 14209",
    distanceMiles: 2.9,
    coordinator: "Marcus Bell",
    capacity: 20,
    duration: "9:00 AM – 12:00 PM",
    training: ["Cleanup safety"],
    requirements: ["Closed-toe shoes"],
    impactMetric: "Bags of litter collected",
  },
  {
    id: "opp-animal",
    slug: "animal-shelter-support",
    title: "Animal Shelter Support",
    cause: "animals",
    organization: "Rivergate Animal Shelter",
    image: "/media/opp-animal-shelter.jpg",
    imageAlt: "Volunteer feeding dogs at an animal shelter",
    description:
      "Socialize shelter dogs, refresh kennels, and prepare enrichment toys. Every session helps a pet become more adoptable.",
    address: "9 Shelter Road, Buffalo, NY 14224",
    distanceMiles: 5.8,
    coordinator: "Nina Vega",
    capacity: 9,
    duration: "10:00 AM – 1:00 PM",
    training: ["Animal handling"],
    requirements: ["Proof of age", "Tetanus up to date"],
    impactMetric: "Hours of enrichment",
  },
  {
    id: "opp-pantry",
    slug: "pantry-setup",
    title: "Pantry Setup",
    cause: "food",
    organization: ORG.name,
    image: "/media/opp-pantry.jpg",
    imageAlt: "Volunteers organizing shelf-stable food donations at a pantry",
    description:
      "Sort donations, stock shelves, and check dates before the weekly pantry opens. This is a quiet, steady morning shift with a big payoff.",
    address: "214 Rivergate Avenue, Buffalo, NY 14206",
    distanceMiles: 1.2,
    coordinator: "Alicia Rivera",
    capacity: 10,
    duration: "8:00 AM – 10:00 AM",
    training: ["Food safety basics"],
    requirements: ["Closed-toe shoes"],
    impactMetric: "Pantry orders filled",
  },
  {
    id: "opp-event",
    slug: "neighborhood-mural-project",
    title: "Neighborhood Mural Project",
    cause: "community",
    organization: "Rivergate Together",
    image: "/media/opp-community-event.jpg",
    imageAlt: "Students and neighbors painting a colorful outdoor mural together",
    description:
      "Bring a neighborhood wall to life with local artists. Volunteers prime panels, mix colors, and help younger painters — no art experience required.",
    address: "Mural Lane, Buffalo, NY 14208",
    distanceMiles: 3.4,
    coordinator: "Elena Marsh",
    capacity: 18,
    duration: "11:00 AM – 3:00 PM",
    training: ["Mural orientation"],
    requirements: ["Friendly attitude"],
    impactMetric: "Neighbors served",
  },
];

const shiftSpecs = [
  [
    "sh-mon-pantry",
    "opp-pantry",
    "2026-10-12T08:00:00-04:00",
    "2026-10-12T10:00:00-04:00",
    12,
    12,
    [
      ["Shelf stocker", 2, 2],
      ["Donation sorter", 2, 2],
    ],
  ],
  [
    "sh-tue-library",
    "opp-library",
    "2026-10-13T14:00:00-04:00",
    "2026-10-13T16:00:00-04:00",
    8,
    8,
    [
      ["Tutor", 1, 1],
      ["Greeter", 1, 1],
    ],
  ],
  [
    "sh-tue-pantry",
    "opp-pantry",
    "2026-10-13T08:00:00-04:00",
    "2026-10-13T10:00:00-04:00",
    4,
    3,
    [
      ["Shelf stocker", 1, 1],
      ["Donation sorter", 1, 1],
    ],
  ],
  [
    "sh-wed-garden",
    "opp-garden",
    "2026-10-14T10:00:00-04:00",
    "2026-10-14T12:30:00-04:00",
    8,
    8,
    [
      ["Gardener", 2, 2],
      ["Tool lead", 1, 1],
    ],
  ],
  [
    "sh-thu-food",
    "opp-food",
    "2026-10-15T14:00:00-04:00",
    "2026-10-15T17:00:00-04:00",
    12,
    10,
    [
      ["General", 2, 2],
      ["Food handling", 1, 1],
    ],
  ],
  [
    "sh-fri-event",
    "opp-event",
    "2026-10-16T11:00:00-04:00",
    "2026-10-16T15:00:00-04:00",
    17,
    13,
    [
      ["Mural assistant", 2, 2],
      ["Setup crew", 1, 1],
      ["Greeter", 1, 1],
    ],
  ],
  [
    "sh-sat-food",
    "opp-food",
    "2026-10-17T09:00:00-04:00",
    "2026-10-17T12:00:00-04:00",
    16,
    10,
    [
      ["Driver", 1, 0],
      ["Spanish Support", 2, 1],
      ["Food handling", 2, 1],
    ],
  ],
  [
    "sh-sat-garden",
    "opp-garden",
    "2026-10-17T13:00:00-04:00",
    "2026-10-17T15:30:00-04:00",
    5,
    3,
    [["Gardener", 2, 2]],
  ],
  [
    "sh-sun-library",
    "opp-library",
    "2026-10-18T14:00:00-04:00",
    "2026-10-18T16:00:00-04:00",
    10,
    9,
    [
      ["Tutor", 1, 1],
      ["Math tutor", 1, 0],
      ["Greeter", 1, 1],
    ],
  ],
  [
    "sh-mon-senior",
    "opp-senior",
    "2026-10-19T10:00:00-04:00",
    "2026-10-19T12:00:00-04:00",
    6,
    6,
    [
      ["Driver", 1, 1],
      ["Delivery pair", 2, 2],
    ],
  ],
  [
    "sh-wed-animal",
    "opp-animal",
    "2026-10-21T10:00:00-04:00",
    "2026-10-21T13:00:00-04:00",
    9,
    7,
    [
      ["Kennel support", 1, 1],
      ["Enrichment", 2, 2],
      ["Greeter", 1, 1],
    ],
  ],
  [
    "sh-sat-park",
    "opp-park",
    "2026-10-24T09:00:00-04:00",
    "2026-10-24T12:00:00-04:00",
    20,
    20,
    [
      ["Cleanup crew", 2, 2],
      ["Tool lead", 1, 1],
      ["Check-in", 1, 1],
      ["Refreshments", 1, 1],
    ],
  ],
  [
    "sh-sun-senior",
    "opp-senior",
    "2026-10-25T10:00:00-04:00",
    "2026-10-25T12:00:00-04:00",
    6,
    5,
    [
      ["Driver", 1, 1],
      ["Delivery pair", 1, 1],
    ],
  ],
  [
    "sh-tue-food",
    "opp-food",
    "2026-10-27T14:00:00-04:00",
    "2026-10-27T17:00:00-04:00",
    14,
    12,
    [
      ["General", 1, 1],
      ["Food handling", 1, 1],
      ["Greeter", 1, 1],
    ],
  ],
  [
    "sh-sat-event",
    "opp-event",
    "2026-10-31T11:00:00-04:00",
    "2026-10-31T15:00:00-04:00",
    18,
    14,
    [
      ["Mural assistant", 1, 1],
      ["Greeter", 1, 1],
    ],
  ],
];

const shifts = shiftSpecs.map(
  ([id, opportunityId, startsAt, endsAt, capacity, confirmed, roles]) => ({
    id,
    opportunityId,
    startsAt,
    endsAt,
    capacity,
    confirmed,
    waitlisted: id === "sh-sat-food" ? 3 : id === "sh-sun-library" ? 1 : 0,
    status: "scheduled",
    roles: roles.map(([name, required, filled]) => ({ name, required, filled })),
  }),
);

// Hours: the current month must total exactly 418 h (25,080 min).
const ROLE_SKILL = {
  "Spanish Support": "Spanish",
  Driver: "Driver",
  "Delivery pair": "Driver",
  Tutor: "Tutoring",
  "Math tutor": "Tutoring",
  "Food handling": "Food handling",
  "Shelf stocker": "Food handling",
  "Donation sorter": "Food handling",
  Gardener: "Gardening",
  "Tool lead": "Gardening",
};
const ROLE_CREDENTIAL = {
  Driver: "Safe driver clearance",
  "Delivery pair": "Safe driver clearance",
  Tutor: "Tutor certification",
  "Math tutor": "Tutor certification",
  "Food handling": "Food safety handler",
  "Shelf stocker": "Food safety handler",
  "Donation sorter": "Food safety handler",
  Gardener: "Garden tool safety",
  "Tool lead": "Garden tool safety",
};

const roleFits = (volunteer, role, shift) => {
  const skill = ROLE_SKILL[role];
  if (skill && !volunteer.skills.includes(skill)) return false;
  const credential = ROLE_CREDENTIAL[role];
  if (!credential) return true;
  return credentials.some(
    (record) =>
      record.volunteerId === volunteer.id &&
      record.name === credential &&
      record.validThrough >= shift.startsAt.slice(0, 10),
  );
};

const registrations = [];
const registrationWindows = new Map();
const overlapsRegistration = (volunteerId, shift) =>
  (registrationWindows.get(volunteerId) ?? []).some(
    ([start, end]) =>
      new Date(start) < new Date(shift.endsAt) && new Date(shift.startsAt) < new Date(end),
  );

for (const [shiftIndex, shift] of shifts.entries()) {
  const used = new Set();
  const ordered = allVolunteers.filter((volunteer) => volunteer.status === "active");
  const pickFor = (role) => {
    for (let step = 0; step < ordered.length; step += 1) {
      const volunteer = ordered[(shiftIndex * 7 + step) % ordered.length];
      if (used.has(volunteer.id)) continue;
      if (!roleFits(volunteer, role, shift)) continue;
      if (overlapsRegistration(volunteer.id, shift)) continue;
      return volunteer;
    }
    return null;
  };
  const add = (volunteer, role) => {
    if (!volunteer || used.has(volunteer.id)) return;
    used.add(volunteer.id);
    registrations.push({
      shiftId: shift.id,
      volunteerId: volunteer.id,
      role,
      status: "registered",
    });
    registrationWindows.set(volunteer.id, [
      ...(registrationWindows.get(volunteer.id) ?? []),
      [shift.startsAt, shift.endsAt],
    ]);
  };

  if (shift.id === "sh-tue-pantry") add(allVolunteers[0], "Shelf stocker");
  for (const role of shift.roles) {
    for (
      let index = registrations.filter((row) => row.shiftId === shift.id).length;
      index < shift.confirmed;
      index += 1
    ) {
      if (shift.roles.reduce((sum, item) => sum + item.filled, 0) <= 0) break;
      const alreadyFilled = registrations.filter(
        (row) => row.shiftId === shift.id && row.role === role.name,
      ).length;
      if (alreadyFilled >= role.filled) break;
      add(pickFor(role.name), role.name);
    }
  }
  while (registrations.filter((row) => row.shiftId === shift.id).length < shift.confirmed) {
    const volunteer = pickFor("General support") ?? pickFor(Object.keys(ROLE_SKILL)[0]);
    if (!volunteer) break;
    add(volunteer, "General support");
  }
}

const hourEntries = [];
const desiredMinutes = 418 * 60 - 1110; // Maya's four entries below complete the 418 h total
const shareCount = 58;
const base = Math.floor(desiredMinutes / shareCount);
const remainder = desiredMinutes - base * shareCount;
for (let i = 0; i < shareCount; i += 1) {
  const volunteer = allVolunteers[(i * 7 + 3) % allVolunteers.length];
  const opportunity = opportunities[(i * 3) % opportunities.length];
  const day = 1 + ((i * 5) % 13);
  hourEntries.push({
    id: `hours-${String(i + 1).padStart(3, "0")}`,
    volunteerId: volunteer.id,
    opportunityId: opportunity.id,
    date: `2026-10-${String(day).padStart(2, "0")}`,
    minutes: i === shareCount - 1 ? base + remainder : base,
    status: i % 11 === 0 ? "pending" : "verified",
    verificationId: i % 11 === 0 ? null : `CFV-2026-${String(1100 + i)}`,
  });
}
// Earlier service records keep the retention cohorts meaningful. Each month
// has first visits and some 30-day returns; the demo month is deliberately
// incomplete because its observation window has not elapsed yet.
const retentionHistory = [
  ["2026-05-04", 5, 180],
  ["2026-05-20", 5, 150],
  ["2026-05-06", 9, 120],
  ["2026-05-12", 14, 210],
  ["2026-06-03", 3, 240],
  ["2026-06-21", 3, 180],
  ["2026-06-08", 7, 150],
  ["2026-07-02", 11, 120],
  ["2026-07-16", 11, 240],
  ["2026-07-07", 16, 180],
  ["2026-07-09", 21, 150],
  ["2026-08-05", 2, 210],
  ["2026-08-19", 2, 180],
  ["2026-08-10", 12, 120],
  ["2026-09-01", 4, 240],
  ["2026-09-15", 4, 180],
  ["2026-09-03", 8, 150],
  ["2026-09-08", 18, 210],
];
retentionHistory.forEach(([date, volunteerIndex, minutes], index) => {
  const volunteer = allVolunteers[volunteerIndex % allVolunteers.length];
  const opportunity = opportunities[(index * 3 + 1) % opportunities.length];
  hourEntries.push({
    id: `history-${String(index + 1).padStart(3, "0")}`,
    volunteerId: volunteer.id,
    opportunityId: opportunity.id,
    date,
    minutes,
    status: "verified",
    verificationId: null,
  });
});
// Maya's own history, matching her 18.5 hours and four events.
const mayaEntries = [
  ["2026-10-05", "opp-library", 180, "CF-2026-1045"],
  ["2026-10-09", "opp-food", 240, "CF-2026-1061"],
  ["2026-10-11", "opp-garden", 150, "CF-2026-1072"],
  ["2026-10-12", "opp-pantry", 540, null],
].map(([date, opportunityId, minutes, verificationId], index) => ({
  id: `hours-maya-${index + 1}`,
  volunteerId: MAYA.id,
  opportunityId,
  date,
  minutes,
  status: verificationId ? "verified" : "pending",
  verificationId,
}));
const totalMinutes = [...hourEntries, ...mayaEntries].reduce(
  (sum, entry) => sum + entry.minutes,
  0,
);

// Explicit outcomes, not hours multiplied into people. One record per metric
// definition keeps the demo readable while the schema supports per-shift rows.
const impactRecords = [
  {
    id: "impact-meals",
    opportunityId: "opp-food",
    metricKey: "meals_packed",
    name: "Meals packed",
    unit: "meals",
    value: 24320,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
  {
    id: "impact-tutoring",
    opportunityId: "opp-library",
    metricKey: "tutoring_sessions",
    name: "Tutoring sessions",
    unit: "sessions",
    value: 73,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
  {
    id: "impact-trees",
    opportunityId: "opp-garden",
    metricKey: "trees_planted",
    name: "Trees planted",
    unit: "trees",
    value: 26,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
  {
    id: "impact-families",
    opportunityId: "opp-senior",
    metricKey: "families_served",
    name: "Families served",
    unit: "families",
    value: 643,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
  {
    id: "impact-enrichment",
    opportunityId: "opp-animal",
    metricKey: "enrichment_hours",
    name: "Enrichment hours",
    unit: "hours",
    value: 120,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
  {
    id: "impact-neighbors",
    opportunityId: "opp-event",
    metricKey: "neighbors_served",
    name: "Neighbors served",
    unit: "neighbors",
    value: 500,
    recordedAt: "2026-10-12T16:00:00-04:00",
  },
];

const workspace = {
  schemaVersion: 1,
  now: DEMO_NOW,
  organization: ORG,
  coordinator: COORDINATOR,
  currentVolunteerId: MAYA.id,
  volunteers: allVolunteers,
  opportunities,
  shifts,
  registrations,
  hourEntries,
  mayaEntries,
  credentials,
  impactRecords,
  impact: {
    hoursYtd: 1847,
    hoursThisMonth: Math.round(
      [...hourEntries, ...mayaEntries]
        .filter((entry) => entry.date.startsWith(DEMO_NOW.slice(0, 7)))
        .reduce((sum, entry) => sum + entry.minutes, 0) / 60,
    ),
    uniqueVolunteersYtd: 327,
    activeVolunteers: allVolunteers.filter((v) => v.status === "active").length,
    mealsPacked: 24320,
    tutoringSessions: 73,
    treesPlanted: 26,
    familiesServedThisMonth: 643,
    shiftsCompleted: 412,
    attendanceRate: 94,
  },
  recentActivity: [
    {
      id: "act-1",
      volunteerId: "vol-maya",
      name: "Maya Chen",
      action: "Checked in",
      detail: "Community Food Distribution",
      tone: "green",
      at: "2026-10-13T08:14:00-04:00",
    },
    {
      id: "act-2",
      volunteerId: "vol-002",
      name: "Jordan Lee",
      action: "Promoted from waitlist",
      detail: "Community Food Distribution",
      tone: "cobalt",
      at: "2026-10-13T07:56:00-04:00",
    },
    {
      id: "act-3",
      volunteerId: "vol-003",
      name: "Ava Patel",
      action: "Hours approved",
      detail: "Library Tutoring · 2.5 h",
      tone: "violet",
      at: "2026-10-12T17:20:00-04:00",
    },
  ],
  notifications: [
    {
      id: "n-1",
      kind: "coverage",
      title: "Driver still needed",
      body: "Saturday's food distribution has no confirmed driver.",
      priority: "high",
      createdAt: "2026-10-13T07:30:00-04:00",
      readAt: null,
      href: "/coordinator/coverage",
    },
    {
      id: "n-2",
      kind: "waitlist",
      title: "Jordan Lee promoted",
      body: "Moved off the waitlist for Saturday's distribution.",
      priority: "normal",
      createdAt: "2026-10-13T07:56:00-04:00",
      readAt: null,
      href: "/coordinator/schedule",
    },
    {
      id: "n-3",
      kind: "hours",
      title: "3 hours need review",
      body: "Maya Chen submitted hours with a note.",
      priority: "normal",
      createdAt: "2026-10-12T18:05:00-04:00",
      readAt: null,
      href: "/coordinator/hours",
    },
  ],
  savedViews: [
    { id: "view-1", name: "High-match food security", filters: { causes: ["food"] } },
    { id: "view-2", name: "Spanish-speaking drivers", filters: { skills: ["Spanish", "Driver"] } },
  ],
};

await fs.mkdir(new URL("../shared/", import.meta.url), { recursive: true });
await fs.writeFile(
  new URL("../shared/demo-workspace.json", import.meta.url),
  `${JSON.stringify(workspace, null, 2)}\n`,
);
console.log(
  `wrote shared/demo-workspace.json: ${workspace.volunteers.length} volunteers, ${workspace.opportunities.length} opportunities, ${workspace.shifts.length} shifts, ${workspace.hourEntries.length + mayaEntries.length} hour entries, ${totalMinutes / 60} h`,
);
