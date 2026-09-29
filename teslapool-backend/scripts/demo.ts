/**
 * Narrated, re-runnable evaluator demo against a RUNNING API (local, Docker or Render).
 *
 *   npm run demo                                  # http://localhost:3000
 *   BASE_URL=http://localhost:4000 npm run demo   # docker compose
 *
 * Registers fresh users each run (unique emails), so it never collides with earlier runs.
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const run = Date.now().toString(36);
const CONTEXT = { traffic: 'MEDIUM', weather: 'CLEAR', timeOfDay: 'OFF_PEAK' };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

function must(r: { status: number; json: Json }, expected: number, what: string): Json {
  if (r.status !== expected) {
    console.error(`\n✗ ${what}: expected HTTP ${expected}, got ${r.status}\n${JSON.stringify(r.json, null, 2)}`);
    process.exit(1);
  }
  return r.json.data ?? r.json;
}

const step = (n: number, title: string) => console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`);
const say = (msg: string) => console.log(`   ${msg}`);
const bdt = (poysha: number) => `৳${(poysha / 100).toFixed(2)}`;

async function user(name: string, role: 'PASSENGER' | 'DRIVER') {
  const email = `${name.split(' ')[0].toLowerCase()}.${run}@demo.teslapool.dev`;
  must(await call('POST', '/api/v1/auth/register', { name, email, password: 'demo-password-123', role }), 201, `register ${name}`);
  const login = must(await call('POST', '/api/v1/auth/login', { email, password: 'demo-password-123' }), 200, `login ${name}`);
  return login.accessToken as string;
}

async function main() {
  console.log(`TeslaPool demo against ${BASE}`);
  const health = await call('GET', '/health/ready');
  say(`readiness: ${health.json.status} (database ${health.json.checks?.database?.status}, ML ${health.json.checks?.ml?.status})`);

  step(1, '8:41 AM, Banani Road 11: sign up Jashim (driver) and Nusrat, Rafiq, Shirin (passengers)');
  const driver = await user('Jashim Uddin', 'DRIVER');
  const nusrat = await user('Nusrat Jahan', 'PASSENGER');
  const rafiq = await user('Rafiq Islam', 'PASSENGER');
  const shirin = await user('Shirin Akter', 'PASSENGER');
  say('✓ JWTs issued (passwords hashed with Argon2id)');

  step(2, 'Jashim registers Bullet (3-seat auto-rickshaw, the "Tesla") and goes online');
  const vehicle = must(await call('POST', '/api/v1/vehicles', { name: 'Bullet', vehicleType: 'AUTO_RICKSHAW', registrationNumber: `DEMO-${run}`.toUpperCase() }, driver), 201, 'vehicle');
  const online = must(await call('POST', '/api/v1/driver/online', { vehicleId: vehicle.id }, driver), 200, 'go online');
  const pool = online.pool;
  say(`${vehicle.name}: ${vehicle.capacity} seats · Jashim online=${online.online} · pool ${pool.status}`);

  step(3, 'Nusrat requests Banani → Mohakhali, paying cash (ETA + fare, pool search)');
  const n = must(await call('POST', '/api/v1/rides', { pickupZone: 'Banani', dropoffZone: 'Mohakhali', context: CONTEXT }, nusrat), 201, 'Nusrat ride');
  say(`distance ${n.estimatedDistanceKm} km (${n.distanceSource}), ETA ${n.estimatedDurationMinutes} min [${n.quote.eta.source}: ${n.quote.eta.reason}]`);
  const fb = n.fareBreakdown;
  say(`fare ${bdt(n.estimatedFare.amountPoysha)} = base ${bdt(fb.base.amountPoysha)} + ${fb.distanceKm} km (${bdt(fb.distanceCharge.amountPoysha)}) + ${fb.pricingDurationMinutes} min at ${fb.trafficLevel} traffic (${bdt(fb.timeCharge.amountPoysha)})`);
  say(`pricing: ${n.quote.fare.reason}; ML advisory estimate ${n.quote.fare.mlPredictedFarePoysha === null ? 'n/a (model offline)' : `${bdt(n.quote.fare.mlPredictedFarePoysha)} (within ±band: ${n.quote.fare.mlWithinGuardrail})`}`);
  const nm = must(await call('POST', `/api/v1/rides/${n.rideRequestId}/match`, undefined, nusrat), 200, 'Nusrat match');
  say(`${nm.decision} → pool ${nm.match?.poolId === pool.id ? '(ours)' : nm.match?.poolId}, route ${nm.match?.route?.join(' → ')}`);

  step(4, 'Rafiq tops up TeslaPay, requests Banani → Gulshan 1; Jashim sees compatible requests and accepts');
  must(await call('POST', '/api/v1/wallet/top-up', { amountPoysha: 50_000 }, rafiq), 201, 'Rafiq top-up');
  const r = must(await call('POST', '/api/v1/rides', { pickupZone: 'Banani', dropoffZone: 'Gulshan1', paymentMethod: 'TESLAPAY', context: CONTEXT }, rafiq), 201, 'Rafiq ride');
  const waiting = must(await call('GET', `/api/v1/pools/${pool.id}/requests`, undefined, driver), 200, 'driver requests') as unknown as Json[];
  for (const w of waiting) say(`driver sees: ${w.passengerFirstName} ${w.pickupZone}→${w.dropoffZone} (${w.requestedSeats} seat) → ${w.decision.headline}`);
  const d = must(await call('POST', `/api/v1/pools/${pool.id}/accept`, { rideRequestId: r.rideRequestId }, driver), 200, 'driver accepts Rafiq');
  say(`${d.decision}: ${d.route.join(' → ')}   score ${d.score}   worst detour ${d.detourKm} km`);
  for (const c of d.checks) say(`  ✓ ${c.message}`);
  for (const alt of d.alternatives) say(`  alternative ${alt.route.join(' → ')}: ${alt.feasible ? 'feasible but scores worse' : `rejected (${alt.violations.join(', ')})`}`);
  say(`capacity ${d.capacity.before} → ${d.capacity.after} of ${d.capacity.total}; Rafiq pays ${bdt(d.fare.farePoysha)} (solo ${bdt(d.fare.soloFarePoysha)}, -${d.fare.discountPercent}% shared)`);

  step(5, 'Shirin asks for 2 seats on the same (perfect) route');
  const s = must(await call('POST', '/api/v1/rides', { pickupZone: 'Banani', dropoffZone: 'Mohakhali', requestedSeats: 2, context: CONTEXT }, shirin), 201, 'Shirin ride');
  const sj = await call('POST', `/api/v1/pools/${pool.id}/join`, { rideRequestId: s.rideRequestId }, shirin);
  must(sj, 409, 'Shirin join should be rejected');
  const err = sj.json.error;
  say(`HTTP 409 ${err.code}: ${err.details.decision.headline}`);
  for (const c of err.details.decision.checks) say(`  ${c.passed ? '✓' : '✗'} ${c.message}`);
  say('→ even a "perfect" route cannot override a deterministic capacity rule');

  step(6, '"Why?": the explanation endpoint (plain language, from stored facts)');
  const xn = must(await call('GET', `/api/v1/rides/${n.rideRequestId}/explanation`, undefined, nusrat), 200, 'explain Nusrat');
  say('Nusrat asks "why am I sharing, and why this price?"');
  for (const line of xn.summary) say(`  • ${line}`);
  for (const line of xn.fare.lines.slice(0, 2)) say(`  • ${line}`);
  const xs = must(await call('GET', `/api/v1/rides/${s.rideRequestId}/explanation`, undefined, shirin), 200, 'explain Shirin');
  say('Shirin asks "why couldn\'t I join?"');
  for (const line of xs.summary) say(`  • ${line}`);

  step(7, 'Jashim: arrive → start → complete (payment settles in the same transaction)');
  for (const [who, id] of [['Nusrat', n.rideRequestId], ['Rafiq', r.rideRequestId]]) {
    for (const action of ['arrive', 'start']) must(await call('POST', `/api/v1/rides/${id}/${action}`, undefined, driver), 200, `${action} ${who}`);
  }
  const rDone = must(await call('POST', `/api/v1/rides/${r.rideRequestId}/complete`, undefined, driver), 200, 'complete Rafiq');
  const nDone = must(await call('POST', `/api/v1/rides/${n.rideRequestId}/complete`, undefined, driver), 200, 'complete Nusrat');
  say(`Rafiq ${bdt(rDone.finalFare.amountPoysha)} via ${rDone.payment.method} · Nusrat ${bdt(nDone.finalFare.amountPoysha)} via ${nDone.payment.method} (integer poysha)`);
  const rw = must(await call('GET', '/api/v1/wallet', undefined, rafiq), 200, 'Rafiq wallet');
  const jw = must(await call('GET', '/api/v1/wallet', undefined, driver), 200, 'Jashim wallet');
  say(`TeslaPay: Rafiq balance ${bdt(rw.balance.amountPoysha)}, Jashim earned ${bdt(jw.balance.amountPoysha)} (cash is collected in person)`);
  const finalPool = must(await call('GET', `/api/v1/pools/${pool.id}`, undefined, driver), 200, 'pool');
  say(`pool status ${finalPool.status}`);

  step(8, 'Nusrat’s immutable timeline');
  const timeline = must(await call('GET', `/api/v1/rides/${n.rideRequestId}/explanation`, undefined, nusrat), 200, 'timeline').timeline as Json[];
  for (const t of timeline) say(`${t.at}  ${t.description}`);

  must(await call('POST', `/api/v1/rides/${s.rideRequestId}/cancel`, { reason: 'demo cleanup' }, shirin), 200, 'cleanup');

  step(9, 'Impact dashboard (computed live from the database)');
  const k = must(await call('GET', '/api/v1/stats/impact'), 200, 'impact');
  say(`trips completed ${k.rides.completed} · passengers pooled ${k.pooling.pooledPassengers} · match success ${k.matching.matchSuccessRate === null ? 'n/a' : `${Math.round(k.matching.matchSuccessRate * 100)}%`}`);
  say(`passenger savings ${bdt(k.pooling.totalPassengerSavings.amountPoysha)} · avg occupancy ${k.occupancy.averagePassengersPerPool ?? 'n/a'}/${k.occupancy.averageCapacity ?? 'n/a'} · seat utilisation ${k.occupancy.seatUtilization === null ? 'n/a' : `${Math.round(k.occupancy.seatUtilization * 100)}%`}`);
  say(`capacity violations ${k.integrity.capacityViolations} (checked ${k.integrity.checkedPools} pools) · wallet drift ${k.integrity.walletBalanceDrift} · unpaid completed rides ${k.integrity.completedRidesWithoutPayment}`);
  say(`payments settled ${k.payments.settled} (cash ${bdt(k.payments.cash.amountPoysha)}, TeslaPay ${bdt(k.payments.teslaPay.amountPoysha)}) · matching p95 ${k.operational.matching.p95Ms} ms · lost races ${k.operational.concurrency.lostRaces}`);
  must(await call('POST', '/api/v1/driver/offline', undefined, driver), 200, 'Jashim offline');
  say('Jashim goes offline (pool completed, nobody assigned)');
  console.log('\n\x1b[32m✓ Demo complete: Predict → Decide → Guarantee\x1b[0m');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
