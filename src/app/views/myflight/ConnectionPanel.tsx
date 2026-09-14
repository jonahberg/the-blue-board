/**
 * Connection risk — the cards found among the watch list, and the manual checker
 * (inventory §19).
 *
 * The verdict is `classifyConnection()` and the pairing is `connection-pairing.js`; this
 * file renders them. Two things in the copy are load-bearing and must not be tightened
 * into something snappier:
 *
 *  - the MCT honesty clause. `MIN_CONNECTION_TIMES` is OUR padded comfort guidance and
 *    United's published minimum is lower, so presenting our number as the airline's
 *    would tell someone to rebook a connection the airline sells.
 *  - the manual checker's three outcomes. A dark feed is not the passenger's typo; the
 *    shipped checker said "check the flight numbers" for every valid input during the
 *    months flight-times was down.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cityFor } from '@/lib/airports.js';
import {
  computeConnectionRisk,
  connectionDetailLine,
  manualConnectionOutcome,
  normalizeConnectionFlight,
} from '@/lib/connection-pairing.js';
import { ApiError, fetchFlightTimes } from '../../data/api';

export type ConnectionRisk = {
  state: 'scored' | 'insufficient' | 'disrupted';
  hasData: boolean;
  risk: string;
  color: string;
  label: string;
  connectionMin: number | null;
  buffer: number | null;
  mct: number;
  walkTime: number;
  inTerminal: string;
  outTerminal: string;
};

export type ConnectionPair = {
  hub: string;
  inbound: { w: { flight: string }; td: { origin?: { iata?: string } } };
  outbound: { w: { flight: string }; td: { destination?: { iata?: string } } };
};

export function ConnectionCard({ conn, risk }: { conn: ConnectionPair; risk: ConnectionRisk }) {
  const detail = connectionDetailLine(risk) as { tone: string; text: string };
  return (
    <Card
      className="gap-2 border-l-4 p-3 text-[11px]"
      style={{ borderLeftColor: risk.color }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Connection at {conn.hub} ({cityFor(conn.hub) || conn.hub})
        </span>
        <span
          className="rounded-md px-1.5 py-0.5 text-[9px] font-bold"
          style={{ backgroundColor: `${risk.color}20`, color: risk.color }}
        >
          {risk.risk}
        </span>
      </div>
      <div className="space-y-0.5 font-mono">
        <div>
          {conn.inbound.w.flight} {conn.inbound.td.origin?.iata || '?'} →{' '}
          <strong>{conn.hub}</strong>
        </div>
        <div>
          {conn.outbound.w.flight} <strong>{conn.hub}</strong> →{' '}
          {conn.outbound.td.destination?.iata || '?'}
        </div>
      </div>
      <p className={detail.tone === 'muted' ? 'text-muted-foreground' : 'text-muted-foreground'}>
        {detail.text}
      </p>
      <p style={{ color: risk.color }}>{risk.label}</p>
    </Card>
  );
}

type ManualState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'message'; tone: 'muted' | 'error'; text: string }
  | { phase: 'result'; conn: ConnectionPair; risk: ConnectionRisk };

export function ManualConnectionCheck() {
  const [inbound, setInbound] = useState('');
  const [outbound, setOutbound] = useState('');
  const [state, setState] = useState<ManualState>({ phase: 'idle' });

  async function check() {
    const inFlight = normalizeConnectionFlight(inbound) as string;
    const outFlight = normalizeConnectionFlight(outbound) as string;
    if (!inFlight || !outFlight) return;
    setState({ phase: 'checking' });

    /** null means the REQUEST failed — a feed outage, not a bad flight number. */
    const lookup = async (flight: string) => {
      try {
        return await fetchFlightTimes(flight);
      } catch (error) {
        if (error instanceof ApiError || error instanceof Error) return null;
        return null;
      }
    };

    try {
      const [r1, r2] = await Promise.all([lookup(inFlight), lookup(outFlight)]);
      const outcome = manualConnectionOutcome(r1, r2, inFlight, outFlight) as {
        kind: string;
        message?: string;
        conn?: ConnectionPair;
      };
      if (outcome.kind === 'outage') {
        setState({ phase: 'message', tone: 'muted', text: outcome.message ?? '' });
        return;
      }
      if (outcome.kind !== 'ok' || !outcome.conn) {
        setState({ phase: 'message', tone: 'error', text: outcome.message ?? '' });
        return;
      }
      const conn = outcome.conn;
      setState({
        phase: 'result',
        conn,
        risk: computeConnectionRisk(conn) as ConnectionRisk,
      });
    } catch {
      setState({ phase: 'message', tone: 'error', text: 'Error checking connection. Try again.' });
    }
  }

  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void check();
    }
  };

  return (
    <section id="myflight-check" className="rounded-md border p-3.5">
      <h3 className="mb-2.5 text-[10px] font-medium uppercase tracking-widest text-primary">
        Check a Connection
      </h3>
      <div className="flex flex-wrap gap-2">
        <Input
          id="conn-inbound"
          aria-label="Inbound flight number"
          placeholder="Inbound (UA 1234)"
          className="min-h-11 flex-1 basis-32 font-mono text-[11px] md:min-h-9"
          value={inbound}
          onChange={(event) => setInbound(event.target.value)}
          onKeyDown={onEnter}
        />
        <Input
          id="conn-outbound"
          aria-label="Outbound flight number"
          placeholder="Outbound (UA 567)"
          className="min-h-11 flex-1 basis-32 font-mono text-[11px] md:min-h-9"
          value={outbound}
          onChange={(event) => setOutbound(event.target.value)}
          onKeyDown={onEnter}
        />
        <Button
          className="min-h-11 whitespace-nowrap text-[11px] md:min-h-9"
          onClick={() => void check()}
          disabled={state.phase === 'checking'}
        >
          {state.phase === 'checking' ? 'Checking…' : 'Check'}
        </Button>
      </div>

      <div id="conn-manual-result" className="mt-2.5">
        {state.phase === 'message' ? (
          <p
            className={`text-[11px] ${state.tone === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}
          >
            {state.text}
          </p>
        ) : null}
        {state.phase === 'result' ? <ConnectionCard conn={state.conn} risk={state.risk} /> : null}
      </div>
    </section>
  );
}
