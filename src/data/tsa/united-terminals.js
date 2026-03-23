/**
 * United Airlines terminal-to-checkpoint mapping for all 7 domestic hubs.
 * Includes checkpoint hours, lane types (Standard, Pre✓, CLEAR, Priority),
 * and United-specific tips.
 *
 * Data sources: airport websites, TSA.gov PreCheck schedule, CLEAR locations.
 * Last verified: 2026-03-22
 */

export const unitedTerminals = {
  ORD: {
    iata: 'ORD',
    name: "Chicago O'Hare International Airport",
    city: 'Chicago, IL',
    terminals: 'Terminal 1 (Concourses B & C)',
    terminalNote: 'United Express regional flights from Terminal 2 (Concourses E & F)',
    checkpoints: [
      {
        name: 'Checkpoint 1 (CP1)',
        terminal: 'Terminal 1',
        hours: '4:00 AM – 8:30 PM',
        lanes: {
          standard: true,
          precheck: false,
          clear: true,
          priority: false,
        },
        precheckHours: null,
        clearHours: '4:30 AM – 8:00 PM',
      },
      {
        name: 'Checkpoint 2 (CP2)',
        terminal: 'Terminal 1',
        hours: '4:15 AM – 8:30 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 8:30 PM',
        clearHours: '4:30 AM – 8:00 PM',
      },
      {
        name: 'Checkpoint 3 (CP3)',
        terminal: 'Terminal 1',
        hours: '4:00 AM – 6:00 PM',
        lanes: {
          standard: true,
          precheck: false,
          clear: false,
          priority: false,
        },
        precheckHours: null,
        clearHours: null,
      },
    ],
    tips: [
      'CP2 has both Pre✓ and CLEAR — it\'s your best bet for expedited screening.',
      'CP3 closes at 6 PM — avoid if you have an evening flight.',
      'Terminal 2 (United Express) uses CP5 with Pre✓ available 3:30 AM – 8:00 PM.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint should I use for United at ORD?',
        answer: 'United Airlines operates from Terminal 1 at O\'Hare. Checkpoint 2 (CP2) is recommended — it has both TSA Pre✓ and CLEAR lanes, and is open from 4:15 AM to 8:30 PM. If you don\'t have Pre✓ or CLEAR, CP1 and CP3 serve standard lanes.',
      },
      {
        question: 'Does United\'s terminal at O\'Hare have TSA PreCheck?',
        answer: 'Yes. TSA PreCheck is available at Checkpoint 2 (CP2) in Terminal 1, open from 4:00 AM to 8:30 PM. United Express passengers using Terminal 2 can access Pre✓ at Checkpoint 5 (CP5).',
      },
      {
        question: 'Is CLEAR available at United\'s O\'Hare terminal?',
        answer: 'Yes. CLEAR+ lanes are available at Checkpoints 1 and 2 in Terminal 1, operating from 4:30 AM to 8:00 PM. CLEAR is also available in Terminals 2 and 5.',
      },
      {
        question: 'What are the busiest times at O\'Hare TSA for United flights?',
        answer: 'Peak screening times at Terminal 1 are 6:00–9:00 AM (morning bank) and 3:00–5:00 PM (afternoon bank). Early morning (before 5:30 AM) and midday (11 AM–1 PM) typically have the shortest waits.',
      },
      {
        question: 'How early should I arrive for United flights at ORD?',
        answer: 'For domestic flights, arrive 2 hours early. For international flights from Terminal 1, arrive 3 hours early. If you have TSA PreCheck or CLEAR, you can often clear security in under 10 minutes, but allow buffer time during peak hours and holidays.',
      },
    ],
  },

  DEN: {
    iata: 'DEN',
    name: 'Denver International Airport',
    city: 'Denver, CO',
    terminals: 'Concourse B (via Jeppesen Terminal)',
    terminalNote: 'All passengers clear security in the main terminal before taking the train to Concourse B',
    checkpoints: [
      {
        name: 'East Security',
        terminal: 'Jeppesen Terminal',
        hours: '4:00 AM – 8:45 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 8:45 PM',
        clearHours: '4:00 AM – 8:45 PM',
      },
      {
        name: 'West Security',
        terminal: 'Jeppesen Terminal',
        hours: '4:00 AM – 8:45 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 8:45 PM',
        clearHours: '4:00 AM – 8:45 PM',
      },
      {
        name: 'Bridge Security',
        terminal: 'Jeppesen Terminal',
        hours: '4:30 AM – 6:00 PM',
        lanes: {
          standard: true,
          precheck: false,
          clear: true,
          priority: false,
        },
        precheckHours: null,
        clearHours: '4:30 AM – 6:00 PM',
      },
    ],
    tips: [
      'East and West checkpoints have identical lane options — choose based on shorter line.',
      'Bridge Security offers scenic views but closes at 6 PM and has no Pre✓.',
      'DEN has a single security zone — once through, you can reach any concourse via train.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint is best for United at Denver?',
        answer: 'United operates from Concourse B at DEN, but all passengers clear security in the main Jeppesen Terminal first. East and West Security checkpoints both have Pre✓ and CLEAR lanes. Pick whichever has the shorter line — both provide access to all concourses via the underground train.',
      },
      {
        question: 'Does Denver airport have TSA PreCheck for United flights?',
        answer: 'Yes. Both East and West Security checkpoints in the Jeppesen Terminal have TSA PreCheck lanes, open from 4:00 AM to 8:45 PM. Bridge Security does not have Pre✓.',
      },
      {
        question: 'Is CLEAR available at Denver airport?',
        answer: 'Yes. CLEAR+ lanes are available at East Security, West Security, and Bridge Security checkpoints. CLEAR at Bridge Security operates from 4:30 AM to 6:00 PM.',
      },
      {
        question: 'How long does TSA take at Denver for United flights?',
        answer: 'Average TSA wait times at DEN range from 5–15 minutes. Peak times are 5:00–8:00 AM and 2:00–5:00 PM. With TSA PreCheck, waits are typically under 5 minutes. DEN\'s new East checkpoint (opened August 2025) has helped reduce congestion significantly.',
      },
      {
        question: 'How early should I arrive for United flights at DEN?',
        answer: 'Arrive 2 hours before domestic flights and 3 hours before international flights. After clearing security, you\'ll take the train to Concourse B — allow an extra 5–10 minutes for the train ride. Pre✓ or CLEAR members can arrive 90 minutes early for domestic flights.',
      },
    ],
  },

  IAH: {
    iata: 'IAH',
    name: 'George Bush Intercontinental Airport',
    city: 'Houston, TX',
    terminals: 'Terminal C (domestic) & Terminal E (international)',
    terminalNote: 'Terminal C serves most United domestic flights; Terminal E handles international departures',
    checkpoints: [
      {
        name: 'Terminal C North',
        terminal: 'Terminal C',
        hours: '4:00 AM – 10:00 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 10:00 PM',
        clearHours: 'Sun–Fri 4:00 AM – 7:00 PM, Sat 4:00 AM – 6:00 PM',
      },
      {
        name: 'Terminal C South',
        terminal: 'Terminal C',
        hours: '4:00 AM – 7:30 PM',
        lanes: {
          standard: true,
          precheck: false,
          clear: false,
          priority: false,
        },
        precheckHours: null,
        clearHours: null,
      },
      {
        name: 'Terminal E',
        terminal: 'Terminal E',
        hours: '4:00 AM – 12:00 AM',
        lanes: {
          standard: true,
          precheck: true,
          clear: false,
          priority: false,
        },
        precheckHours: '4:00 AM – 8:00 PM',
        clearHours: null,
      },
    ],
    tips: [
      'Terminal C North is the only checkpoint with both Pre✓ and CLEAR — use it when available.',
      'Terminal C South closes at 7:30 PM and has standard lanes only.',
      'Terminal E Pre✓ closes at 8 PM — arrive early for evening international departures.',
      'The Subway train connects Terminals C and E airside. No need to re-clear security.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint should I use for United at IAH?',
        answer: 'For domestic United flights, use Terminal C North — it has TSA Pre✓ and CLEAR, open until 10 PM. Terminal C South is standard lanes only and closes at 7:30 PM. For international flights, Terminal E has Pre✓ until 8 PM.',
      },
      {
        question: 'Does United at Houston IAH have TSA PreCheck?',
        answer: 'Yes. TSA PreCheck is available at Terminal C North (open until 10 PM) and Terminal E (open until 8 PM). Terminal C South does not have Pre✓ lanes.',
      },
      {
        question: 'Is CLEAR available at United\'s IAH terminals?',
        answer: 'CLEAR is available at Terminal C North only. Hours are Sunday–Friday 4:00 AM – 7:00 PM and Saturday 4:00 AM – 6:00 PM. Terminal E does not have CLEAR.',
      },
      {
        question: 'What are the busiest times at IAH TSA for United?',
        answer: 'Peak times at Terminal C are 5:30–8:30 AM (morning banks to East Coast) and 3:00–6:00 PM. Terminal E peaks around 4:00–7:00 PM for evening European departures. Summer thunderstorm season (May–September) can cause cascading delays that back up security lines.',
      },
      {
        question: 'How early should I arrive for United flights at IAH?',
        answer: 'Arrive 2 hours before domestic flights and 3 hours before international flights. IAH is a large airport — allow extra time to navigate between terminals if connecting. The Subway people mover connects all terminals airside.',
      },
    ],
  },

  EWR: {
    iata: 'EWR',
    name: 'Newark Liberty International Airport',
    city: 'Newark, NJ',
    terminals: 'Terminal C & Terminal A',
    terminalNote: 'Terminal C is United\'s primary hub. The new Terminal A (opened 2023) handles some United flights',
    checkpoints: [
      {
        name: 'Terminal C Main',
        terminal: 'Terminal C',
        hours: '24 hours',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: true,
        },
        precheckHours: '24 hours',
        clearHours: '4:00 AM – 10:00 PM',
      },
      {
        name: 'Terminal C North Satellite',
        terminal: 'Terminal C',
        hours: 'Variable (peak hours)',
        lanes: {
          standard: true,
          precheck: true,
          clear: false,
          priority: false,
        },
        precheckHours: 'Variable',
        clearHours: null,
      },
      {
        name: 'Terminal A',
        terminal: 'Terminal A',
        hours: '24 hours',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '24 hours',
        clearHours: 'Sun–Fri 4:30 AM – 8:00 PM, Sat 4:30 AM – 7:00 PM',
      },
    ],
    tips: [
      'Terminal C Main is the only EWR checkpoint with all 4 lane types including Priority.',
      'EWR is the most delay-prone major US airport — TSA lines can exceed 90 minutes during peak.',
      'CLEAR closes at 10 PM in Terminal C — if you have a red-eye, Pre✓ is your best option.',
      'The Terminal C North Satellite checkpoint opens during peak hours and usually has shorter lines.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint should I use for United at Newark?',
        answer: 'Terminal C Main is United\'s primary checkpoint at EWR — it\'s the only one with Standard, Pre✓, CLEAR, and Priority lanes, and it\'s open 24 hours. For shorter lines during peak hours, check if the Terminal C North Satellite checkpoint is open.',
      },
      {
        question: 'Does Newark Terminal C have TSA PreCheck?',
        answer: 'Yes. TSA PreCheck is available 24/7 at Terminal C Main, with two dedicated lanes. The North Satellite checkpoint also has a Pre✓ lane when open. Terminal A has Pre✓ 24/7 as well.',
      },
      {
        question: 'Is CLEAR available at United\'s Newark terminal?',
        answer: 'Yes. CLEAR+ lanes are available at Terminal C Main from 4:00 AM to 10:00 PM, and at Terminal A from 4:30 AM to 8:00 PM (7:00 PM Saturdays).',
      },
      {
        question: 'How bad are TSA wait times at Newark for United?',
        answer: 'EWR is notorious for long TSA lines. Peak evening departure times (4:00–7:00 PM) for European flights can see standard lanes exceed 60–90 minutes. TSA PreCheck averages around 7 minutes. Always allow extra time at EWR — it consistently ranks as the most delay-prone major US airport.',
      },
      {
        question: 'How early should I arrive for United flights at EWR?',
        answer: 'Arrive at least 2.5 hours before domestic flights and 3.5 hours before international flights. EWR\'s security lines are unpredictable and can spike suddenly. With Pre✓ or CLEAR, 2 hours domestic / 3 hours international is usually sufficient.',
      },
    ],
  },

  SFO: {
    iata: 'SFO',
    name: 'San Francisco International Airport',
    city: 'San Francisco, CA',
    terminals: 'Terminal 3 (domestic) & International Terminal G',
    terminalNote: 'Terminal 3 serves United domestic; International Terminal boarding area G serves United international',
    checkpoints: [
      {
        name: 'Terminal 3 Checkpoint',
        terminal: 'Terminal 3',
        hours: '4:00 AM – 11:00 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 10:00 PM',
        clearHours: '4:00 AM – 10:00 PM',
      },
      {
        name: 'International Terminal (G Gates)',
        terminal: 'International Terminal',
        hours: '24 hours',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:30 AM – 10:00 PM',
        clearHours: '7:00 AM – 10:00 PM',
      },
    ],
    tips: [
      'Terminal 3 connects airside to International Terminal G — clear security once.',
      'Checkpoint F in Terminal 3 may be closed for construction — check before arriving.',
      'CLEAR opens later at the International Terminal (7 AM vs 4 AM at Terminal 3).',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint should I use for United at SFO?',
        answer: 'United domestic flights use Terminal 3 — the main checkpoint has Pre✓ and CLEAR lanes. For international flights, use the International Terminal checkpoint (boarding area G). Both terminals are connected airside.',
      },
      {
        question: 'Does SFO have TSA PreCheck for United flights?',
        answer: 'Yes. TSA PreCheck is available at Terminal 3 (4:00 AM – 10:00 PM) and the International Terminal (4:30 AM – 10:00 PM).',
      },
      {
        question: 'Is CLEAR available at SFO for United passengers?',
        answer: 'Yes. CLEAR+ lanes are at Terminal 3 (4:00 AM – 10:00 PM) and the International Terminal (7:00 AM – 10:00 PM). Note CLEAR opens 3 hours later at the International Terminal.',
      },
      {
        question: 'How long does TSA take at SFO for United flights?',
        answer: 'Average TSA wait times at SFO Terminal 3 are 10–20 minutes. Peak times are 6:00–9:00 AM and 3:00–6:00 PM. With Pre✓, waits are typically 5 minutes or less. SFO fog can cause flight delays that back up the terminal.',
      },
      {
        question: 'How early should I arrive for United flights at SFO?',
        answer: 'Arrive 2 hours before domestic flights and 3 hours before international flights. SFO is compact and efficient, but Bay Area traffic to the airport can be unpredictable.',
      },
    ],
  },

  IAD: {
    iata: 'IAD',
    name: 'Washington Dulles International Airport',
    city: 'Washington, DC',
    terminals: 'Main Terminal (shared facility)',
    terminalNote: 'All airlines share the main terminal. United uses Concourses C and D (via AeroTrain)',
    checkpoints: [
      {
        name: 'East Checkpoint',
        terminal: 'Main Terminal',
        hours: '3:45 AM – 10:30 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:30 AM – 9:00 PM',
        clearHours: '4:30 AM – 9:30 PM',
      },
      {
        name: 'West Checkpoint',
        terminal: 'Main Terminal',
        hours: '4:45 AM – 9:00 PM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:30 AM – 9:00 PM',
        clearHours: '4:30 AM – 9:30 PM',
      },
    ],
    tips: [
      'East Checkpoint opens an hour earlier than West — best for early flights.',
      'Both checkpoints have identical Pre✓ and CLEAR availability.',
      'After security, take the AeroTrain to Concourse C (domestic) or D (international).',
      'IAD\'s security is generally efficient — typically 10–15 min for standard lanes.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint should I use for United at Dulles?',
        answer: 'Dulles has East and West checkpoints in the main terminal — both have Pre✓ and CLEAR. Choose whichever has the shorter line. The East Checkpoint opens an hour earlier (3:45 AM vs 4:45 AM).',
      },
      {
        question: 'Does Dulles have TSA PreCheck for United flights?',
        answer: 'Yes. Both East and West checkpoints have TSA PreCheck lanes, available from 4:30 AM to 9:00 PM.',
      },
      {
        question: 'Is CLEAR available at Dulles airport?',
        answer: 'Yes. CLEAR+ lanes are at both East and West checkpoints, open from 4:30 AM to 9:30 PM. CLEAR kiosks are located near each checkpoint on the Departures level.',
      },
      {
        question: 'How long does TSA take at Dulles for United flights?',
        answer: 'TSA wait times at IAD average 10–15 minutes. Peak times are 5:00–8:00 AM and 3:00–6:00 PM. PreCheck averages about 3 minutes. IAD is generally one of the more efficient airports for security screening.',
      },
      {
        question: 'How early should I arrive for United flights at IAD?',
        answer: 'Arrive 2 hours before domestic flights and 3 hours before international flights. After clearing security, you\'ll take the AeroTrain to your concourse — allow 5–10 minutes for the ride.',
      },
    ],
  },

  LAX: {
    iata: 'LAX',
    name: 'Los Angeles International Airport',
    city: 'Los Angeles, CA',
    terminals: 'Terminals 7 & 8',
    terminalNote: 'United uses a shared security checkpoint at Terminal 7 serving both Terminals 7 and 8',
    checkpoints: [
      {
        name: 'Terminal 7 Checkpoint',
        terminal: 'Terminal 7',
        hours: '4:00 AM – 12:00 AM',
        lanes: {
          standard: true,
          precheck: true,
          clear: true,
          priority: false,
        },
        precheckHours: '4:00 AM – 10:30 PM',
        clearHours: '4:00 AM – 10:30 PM',
      },
    ],
    tips: [
      'There\'s only one checkpoint serving both Terminals 7 and 8 — lines can build up fast.',
      'LAX Fast Lane is free for all passengers departing T7/T8, available 5:00 AM – 1:00 PM.',
      'Pre✓ and CLEAR share the same checkpoint — combine them for fastest screening.',
      'LAX traffic is unpredictable — allow extra time for the drive to the airport.',
    ],
    faq: [
      {
        question: 'Which TSA checkpoint does United use at LAX?',
        answer: 'United uses the Terminal 7 checkpoint, which serves both Terminals 7 and 8. It\'s a 12-lane checkpoint open from 4:00 AM to midnight. Pre✓, CLEAR, and the free LAX Fast Lane are all available.',
      },
      {
        question: 'Does LAX have TSA PreCheck for United flights?',
        answer: 'Yes. TSA PreCheck lanes are available at the Terminal 7 checkpoint from 4:00 AM to 10:30 PM.',
      },
      {
        question: 'Is CLEAR available at United\'s LAX terminal?',
        answer: 'Yes. CLEAR+ lanes are at the Terminal 7 checkpoint from 4:00 AM to 10:30 PM.',
      },
      {
        question: 'What is the LAX Fast Lane for United passengers?',
        answer: 'LAX Fast Lane is a free expedited screening service available to all passengers at Terminals 7 and 8 from 5:00 AM to 1:00 PM daily. It\'s separate from Pre✓ and CLEAR — anyone can use it during operating hours.',
      },
      {
        question: 'How early should I arrive for United flights at LAX?',
        answer: 'Arrive 2.5 hours before domestic flights and 3.5 hours before international flights. LAX is one of the busiest airports in the US, and LA traffic to the airport is notoriously unpredictable. With Pre✓ or CLEAR, 2 hours domestic / 3 hours international is usually enough.',
      },
    ],
  },
};

/** Ordered list of hub IATA codes (matches hubOrder from src/data/hubs/index.js) */
export const tsaHubOrder = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX'];

/** Flat list of all FAQ entries with hub context for structured data */
export function getAllFaqEntries() {
  return tsaHubOrder.flatMap((code) => {
    const hub = unitedTerminals[code];
    return hub.faq.map((entry) => ({
      hub: code,
      hubName: hub.name,
      ...entry,
    }));
  });
}
