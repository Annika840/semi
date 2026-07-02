import React, { useState, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, ReferenceLine
} from "recharts";

// --- Constants ---
const kB = 8.617e-5; // eV/K

// --- Safety helpers ---
function safeExp(x) {
  if (x < -100) return 0;
  if (x > 100) return Math.exp(100);
  return Math.exp(x);
}

function clampT(T) {
  return Math.max(1, T);
}

// --- Physics helpers ---
function varshni(Eg0, T) {
  const alpha = 5e-4;
  const beta = 200;
  return Eg0 - (alpha * T * T) / (T + beta);
}

function intrinsicDensity(Eg, T) {
  const TT = clampT(T);
  return safeExp(-Eg / (2 * kB * TT));
}

// Parabolic DOS (scaled, teaching version)
function Dc(E, Ec, me) {
  // 3D DOS ~ (m*)^(3/2) * sqrt(E-Ec)
  return E > Ec ? Math.pow(me, 1.5) * Math.sqrt(E - Ec) : 0;
}
function Dv(E, Ev, mh) {
  // 3D DOS ~ (m*)^(3/2) * sqrt(Ev-E)
  return E < Ev ? Math.pow(mh, 1.5) * Math.sqrt(Ev - E) : 0;
}

function fermi(E, Ef, T) {
  const TT = clampT(T);
  return 1 / (1 + safeExp((E - Ef) / (kB * TT)));
}

function generateDOS(Eg, Ef, T, me, mh) {
  const data = [];
  const Ec = Eg / 2;
  const Ev = -Eg / 2;

  for (let E = -1.5; E <= 1.5; E += 0.01) {
    const dC = Dc(E, Ec, me);
    const dV = Dv(E, Ev, mh);
    const f = fermi(E, Ef, T);

    // physically correct carrier densities (no artificial scaling)
    data.push({
      E: Number(E.toFixed(2)),
      Dc: dC,
      Dv: dV,
      f: f,
      n: dC * f,
      p: dV * (1 - f)
    });
  }
  return data;
}

function generateAbsorption(Eg, direct, Eb, nMax, excitonType, T) {
  const data = [];

  // 🔥 much sharper linewidth (low-T sharp peaks)
  // 🔥 physically correct: linewidth increases with T, so peaks are sharp at LOW T
  // 🔥 stronger temperature dependence (make effect clearly visible)
  // 🔥 fix: much stronger broadening at high T (phonon dominated)
  const TT = clampT(T);
  const sigma = 0.0002 + 0.000002 * TT * TT; // quadratic in T // eV
  const sigmaF = 8 * sigma; // Frenkel broader

  for (let E = 0; E <= 3; E += 0.005) {
    let alpha = 0;
    let excitonSum = 0;

    if (excitonType === "Wannier") {
      // 🔥 IMPORTANT: number of visible bound states depends on binding energy
      const nEffectiveMax = Math.min(nMax, Math.floor(Math.sqrt(Eb / sigma)));

      for (let n = 1; n <= Math.max(1, nEffectiveMax); n++) {
        const En = Eg - Eb / (n * n);
        excitonSum += (sigma / Math.PI) / ((E - En)*(E - En) + sigma*sigma) / (n * n);
      }
    } else {
      // Frenkel: single broad exciton
      const En = Eg - Eb;
      excitonSum = 2.0 * (sigmaF / Math.PI) / ((E - En)*(E - En) + sigmaF*sigmaF);
    }

    // 🔥 Physically correct absorption: step at Eg + JDOS (no thermal suppression)
    let bandEdge = 0;
    if (direct) bandEdge = E > Eg ? Math.sqrt(E - Eg) : 0;
    else bandEdge = E > Eg ? Math.pow(E - Eg, 2) * 0.3 : 0;

    // 🔥 spectral weight transfer (exciton borrows oscillator strength)
    const Sw = Math.min(0.9, Eb / (Eb + 0.05)) * safeExp(-T / 400);

    // 🔥 PHYSICALLY CONSISTENT Saha model (scaled)
    // use dimensionless version to avoid unphysical T^3 blow-up
    const saha = safeExp(-Eb / (kB * clampT(T)));
    const f_bound = 1 / (1 + saha);
    const merge = f_bound;

    // exciton loses weight and broadens into continuum
    // 🔥 Correct spectral weight conservation (no double counting)
    const excitonWeight = Sw * merge;
    const continuumWeight = 1 - excitonWeight;

    alpha = excitonWeight * excitonSum + continuumWeight * bandEdge;

    data.push({ E: Number(E.toFixed(3)), alpha });
  }
  return data;
}

function generatePL(Eg, direct, Eb, nMax, excitonType, T) {
  const data = [];

  // 🔥 much sharper linewidth
  // 🔥 physically correct: linewidth increases with T, so peaks are sharp at LOW T
  // 🔥 stronger temperature dependence (make effect clearly visible)
  // 🔥 fix: much stronger broadening at high T (phonon dominated)
  const TT = clampT(T);
  const sigma = 0.0002 + 0.000002 * TT * TT; // quadratic in T
  const sigmaF = 8 * sigma;

  for (let E = 0; E <= 3; E += 0.005) {
    let I = 0;

    if (excitonType === "Wannier") {
      const Ex1 = Eg - Eb;
      const Sw = Math.min(0.9, Eb / (Eb + 0.05)) * safeExp(-T / 400);
      // 🔥 use Lorentzian (consistent with absorption)
      const excitonPL = (1.2 + Sw) * (sigma / Math.PI) / ((E - Ex1)*(E - Ex1) + sigma*sigma);

      let rydberg = 0;
      for (let n = 2; n <= nMax; n++) {
        const En = Eg - Eb / (n * n);
        rydberg += 0.7 * (sigma / Math.PI) / ((E - En)*(E - En) + sigma*sigma) / (n * n);
      }

      // 🔥 Physically correct PL: continuum emission near Eg (no artificial spike)
      // Boltzmann tail above Eg (carriers recombine near band edge)
      let bandPL = 0;
      if (direct) {
        if (E >= Eg) {
          bandPL = Math.sqrt(E - Eg) * safeExp(-(E - Eg) / (kB * clampT(T)));
        }
      } else {
        if (E >= Eg) {
          bandPL = 0.1 * Math.pow(E - Eg, 2) * safeExp(-(E - Eg) / (kB * clampT(T)));
        }
      }

      // spectral weight transfer (reduce band when exciton strong)
      bandPL *= (1 - Sw);

      // 🔥 PHYSICALLY CONSISTENT Saha model (scaled)
    // use dimensionless version to avoid unphysical T^3 blow-up
    const saha = safeExp(-Eb / (kB * clampT(T)));
    const f_bound = 1 / (1 + saha);
    const merge = f_bound;

      // 🔥 avoid double counting: exciton weight redistributes into continuum
      const excitonWeight = Sw * merge;
      const continuumWeight = 1 - excitonWeight;

      const excitonTotal = excitonWeight * (excitonPL + rydberg);
      const continuumTotal = continuumWeight * bandPL;

      I = excitonTotal + continuumTotal;

    } else {
      // Frenkel: broad emission
      const En = Eg - Eb;
      I = 2.0 * (sigmaF / Math.PI) / ((E - En)*(E - En) + sigmaF*sigmaF);
    }

    data.push({ E: Number(E.toFixed(3)), I });
  }
  return data;
}

const materials = {
  Si: { Eg: 1.1, direct: false },
  GaAs: { Eg: 1.42, direct: true },
  GaP: { Eg: 2.26, direct: false },
  WSe2: { Eg: 1.65, direct: true }
};

export default function App() {
  const [Eg0, setEg0] = useState(1.1);
  const [direct, setDirect] = useState(false);
  const [temp, setTemp] = useState(300);
  const [challenge, setChallenge] = useState("none");

  // NEW parameters
  const [me, setMe] = useState(1.0);
  const [mh, setMh] = useState(1.0);
  const [EfUser, setEfUser] = useState(0);
  const [autoEf, setAutoEf] = useState(true);

  // NEW: Tabs
  const [tab, setTab] = useState("thermal");

  // NEW: exciton parameters
  const [Eb, setEb] = useState(0.05);
  const [excitonType, setExcitonType] = useState("Wannier");
  const nMax = 6; // fixed number of Rydberg states // "thermal" | "optics"

  const Eg = useMemo(() => varshni(Eg0, temp), [Eg0, temp]);
  const ni = useMemo(() => intrinsicDensity(Eg, temp), [Eg, temp]);

  const absorption = useMemo(() => generateAbsorption(Eg, direct, Eb, nMax, excitonType, temp), [Eg, direct, Eb, nMax, excitonType, temp]);
  const pl = useMemo(() => generatePL(Eg, direct, Eb, nMax, excitonType, temp), [Eg, direct, Eb, nMax, excitonType, temp]);

  function chargeImbalance(Ef_test) {
    const data = generateDOS(Eg, Ef_test, temp, me, mh);
    const nTot = data.reduce((s, d) => s + d.n, 0);
    const pTot = data.reduce((s, d) => s + d.p, 0);
    return nTot - pTot;
  }

  function solveEf() {
    let Ev = -Eg / 2;
    let Ec = Eg / 2;

    let left = Ev;
    let right = Ec;

    let fL = chargeImbalance(left);
    let fR = chargeImbalance(right);

    if (fL * fR > 0) return 0;

    for (let i = 0; i < 50; i++) {
      const mid = 0.5 * (left + right);
      const fM = chargeImbalance(mid);

      if (fL * fM < 0) {
        right = mid;
        fR = fM;
      } else {
        left = mid;
        fL = fM;
      }
    }

    return 0.5 * (left + right);
  }

  const Ef = useMemo(() => (autoEf ? solveEf() : EfUser), [autoEf, EfUser, Eg, temp, me, mh]);
  const dosRaw = useMemo(() => generateDOS(Eg, Ef, temp, me, mh), [Eg, Ef, temp, me, mh]);

  // 🔥 FIX: normalize DOS for visualization (prevents carriers from dominating plot)
  const maxDOS = Math.max(...dosRaw.map(d => Math.max(d.Dc, d.Dv)), 1);

  const dos = dosRaw.map(d => ({
    ...d,
    Dc: d.Dc / maxDOS,
    Dv: d.Dv / maxDOS,
    f: d.f,          // already 0–1
    n: d.n / maxDOS, // scale carriers consistently
    p: d.p / maxDOS
  }));

  // --- totals for thermally excited carriers ---
  const { nTot, pTot } = useMemo(() => {
    const nSum = dos.reduce((s, d) => s + d.n, 0);
    const pSum = dos.reduce((s, d) => s + d.p, 0);
    return { nTot: nSum, pTot: pSum };
  }, [dos]);

  // --- effective density of states (scaled units, consistent with DOS model) ---
  const { Nc, Nv } = useMemo(() => {
    const Nc_val = Math.pow(me * kB * temp, 1.5);
    const Nv_val = Math.pow(mh * kB * temp, 1.5);
    return { Nc: Nc_val, Nv: Nv_val };
  }, [me, mh, temp]);

  // --- temperature sweep for carrier densities ---
  function solveEfAt(Tval, Eg0val) {
    const EgT = varshni(Eg0val, Tval);
    let left = -EgT / 2;
    let right = EgT / 2;

    function imbalance(Ef_test) {
      const data = generateDOS(EgT, Ef_test, Tval, me, mh);
      const nSum = data.reduce((s, d) => s + d.n, 0);
      const pSum = data.reduce((s, d) => s + d.p, 0);
      return nSum - pSum;
    }

    let fL = imbalance(left);
    let fR = imbalance(right);
    if (fL * fR > 0) return 0;

    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (left + right);
      const fM = imbalance(mid);
      if (fL * fM < 0) {
        right = mid;
        fR = fM;
      } else {
        left = mid;
        fL = fM;
      }
    }
    return 0.5 * (left + right);
  }

  const tempSweep = useMemo(() => {
    const arr = [];
    for (let Tval = 50; Tval <= 500; Tval += 10) {
      // 🔥 IMPORTANT: keep Eg constant for clean Arrhenius
      const EgConst = Eg0; 

      const nInt = intrinsicDensity(EgConst, Tval);

      arr.push({
        T: Tval,
        n: nInt,
        p: nInt,
        invT: 1 / Tval,
        ln_n: Math.log(nInt),
        ln_p: Math.log(nInt)
      });
    }

    return arr.sort((a, b) => a.invT - b.invT);
  }, [Eg0]);

  const { score, feedback, color } = useMemo(() => {
    if (challenge === "none") return { score: null, feedback: null, color: "gray" };

    let s = 0;
    let fb = "";

    if (challenge === "LED") {
      if (direct) s += 50;
      else fb += "Need direct bandgap. ";

      if (Eg > 1.8 && Eg < 2.5) s += 50;
      else fb += "Eg not in visible optimal range. ";

      if (s === 100) fb = "Perfect LED material!";
    }

    if (challenge === "Solar") {
      if (Eg > 1.1 && Eg < 1.6) s += 70;
      else fb += "Eg not optimal for solar. ";
      if (!direct) s += 30;
    }

    if (challenge === "Detector") {
      if (Eg < 1.2) s += 100;
      else fb += "Gap too large for IR detection. ";
    }

    const col = s > 80 ? "green" : s > 40 ? "yellow" : "red";
    return { score: s, feedback: fb, color: col };
  }, [challenge, Eg, direct]);

  return (
    <div className="p-4 bg-black text-white min-h-screen">
      <h1 className="text-2xl mb-4">Semiconductor Explorer</h1>

      {/* Learning goals */}
      

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("thermal")} className={`px-3 py-1 rounded ${tab === "thermal" ? "bg-blue-600" : "bg-gray-700"}`}>
          Thermal Excitation
        </button>
        <button onClick={() => setTab("optics")} className={`px-3 py-1 rounded ${tab === "optics" ? "bg-blue-600" : "bg-gray-700"}`}>
          Optics
        </button>
      </div>

      {/* Controls */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div>
          <label>Bandgap Eg₀: {Eg0.toFixed(2)} eV</label>
          <input type="range" min="0.5" max="3" step="0.01" value={Eg0}
            onChange={(e) => setEg0(parseFloat(e.target.value))} />
        </div>

        <div>
          <label>Temperature: {temp} K</label>
          <input type="range" min="50" max="500" step="10" value={temp}
            onChange={(e) => setTemp(parseInt(e.target.value))} />
        </div>

        <div>
          <button onClick={() => setDirect(!direct)} className="bg-gray-700 p-2 rounded w-full">
            {direct ? "Direct Bandgap" : "Indirect Bandgap"}
          </button>
        </div>
      </div>

      {/* NEW: Effective masses + Fermi level */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div>
          <label>Electron mass m*e: {me.toFixed(2)}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={me}
            onChange={(e) => setMe(parseFloat(e.target.value))} />
        </div>

        <div>
          <label>Hole mass m*h: {mh.toFixed(2)}</label>
          <input type="range" min="0.1" max="5" step="0.1" value={mh}
            onChange={(e) => setMh(parseFloat(e.target.value))} />
        </div>

        <div>
          <label>Fermi level E_F: {Ef.toFixed(2)} eV {autoEf && "(auto)"}</label>
          <input type="range" min={-(Eg/2)} max={(Eg/2)} step="0.01" value={EfUser}
            disabled={autoEf}
            onChange={(e) => setEfUser(parseFloat(e.target.value))} />
          <button className="mt-2 bg-gray-700 p-1 rounded" onClick={() => setAutoEf(!autoEf)}>
            {autoEf ? "Switch to manual E_F" : "Auto (charge neutrality)"}
          </button>
        </div>
      </div>

      {tab === "thermal" && (
      <div>
      {/* DOS + Fermi plot */}
      <div className="mb-6">
        <div className="bg-gray-900 rounded-2xl p-4 shadow-lg mb-4">
        <h2 className="text-xl font-semibold mb-3">DOS & Fermi Function</h2>

        {/* formulas nicely formatted */}
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="bg-black/40 rounded-xl p-3">
            <div className="text-gray-400 mb-1">Energy-resolved</div>
            <div className="text-red-400">
              <span>n(E) = D</span><sub>c</sub><span>(E) · f(E)</span>
            </div>
            <div className="text-blue-400">
              <span>p(E) = D</span><sub>v</sub><span>(E) · (1 − f(E))</span>
            </div>
          </div>

          <div className="bg-black/40 rounded-xl p-3">
            <div className="text-gray-400 mb-1">Integrated (textbook)</div>
            <div className="text-red-400 font-mono">
              n = N<sub>c</sub> · e<sup>−(E<sub>c</sub> − E<sub>F</sub>)/(k<sub>B</sub>T)</sup>
            </div>
            <div className="text-blue-400 font-mono">
              p = N<sub>v</sub> · e<sup>−(E<sub>F</sub> − E<sub>v</sub>)/(k<sub>B</sub>T)</sup>
            </div>
          </div>

          <div className="bg-black/40 rounded-xl p-3">
            <div className="text-gray-400 mb-1">Intrinsic</div>
            <div className="text-gray-200 font-mono">
              n<sub>i</sub> = √(N<sub>c</sub>N<sub>v</sub>) · e<sup>−E<sub>g</sub>/(2k<sub>B</sub>T)</sup>
            </div>
          </div>

          <div className="bg-black/40 rounded-xl p-3">
            <div className="text-gray-400 mb-1">Density of states</div>
            <div className="text-gray-200 font-mono">
              N<sub>c</sub> ∝ (m*<sub>e</sub> k<sub>B</sub>T)<sup>3/2</sup>
            </div>
            <div className="text-gray-200 font-mono">
              N<sub>v</sub> ∝ (m*<sub>h</sub> k<sub>B</sub>T)<sup>3/2</sup>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full h-[300px] bg-black rounded-xl p-2">
      <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dos}>
            <CartesianGrid stroke="#444" />
            <XAxis dataKey="E" tick={{ fill: '#aaa', fontSize: 12 }} label={{ value: "Energy (eV)", position: "insideBottomRight", offset: -5, fill: '#aaa' }} />
            <YAxis domain={[0, 'auto']} width={60} tick={{ fill: '#aaa', fontSize: 12 }} label={{ value: "Intensity", angle: -90, position: "insideLeft", fill: '#aaa' }} />
            <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
            <Legend />

            <ReferenceLine x={Ef} stroke="white" strokeWidth={2} label={{ value: "E_F", fill: "white" }} />
            <ReferenceLine x={Eg/2} stroke="#00ffcc" strokeDasharray="3 3" label={{ value: "E_C", fill: "#00ffcc" }} />
            <ReferenceLine x={-Eg/2} stroke="#00ffcc" strokeDasharray="3 3" label={{ value: "E_V", fill: "#00ffcc" }} />

            <Line dataKey="Dc" name="D_c(E)" dot={false} stroke="#00ffcc" strokeWidth={2} />
            <Line dataKey="Dv" name="D_v(E)" dot={false} stroke="#00ccff" strokeWidth={2} />
            <Line dataKey="f" name="f(E)" dot={false} stroke="#ffcc00" strokeWidth={2} strokeDasharray="5 5" />
          </AreaChart>
      </ResponsiveContainer>
      </div>

        {/* --- numeric values --- */}
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="text-sm text-gray-300">Electrons (thermally excited)</h4>
            <p className="text-lg">n = {nTot.toExponential(3)}</p>
          </div>
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="text-sm text-gray-300">Holes (thermally excited)</h4>
            <p className="text-lg">p = {pTot.toExponential(3)}</p>
          </div>
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="text-sm text-gray-300">Charge balance</h4>
            <p className="text-lg">n - p = {(nTot - pTot).toExponential(3)}</p>
          </div>
        </div>

        {/* --- Nc, Nv --- */}
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="text-sm text-gray-300">Effective DOS (conduction)</h4>
            <p className="text-lg">N_c ∝ {Nc.toExponential(3)}</p>
          </div>
          <div className="bg-gray-800 p-3 rounded">
            <h4 className="text-sm text-gray-300">Effective DOS (valence)</h4>
            <p className="text-lg">N_v ∝ {Nv.toExponential(3)}</p>
          </div>
        </div>

        <h3 className="mt-4">Zoom near band edge</h3>
        {(() => {
          const Ec = Eg/2;
          const Ev = -Eg/2;
          const dE = Math.max(0.1, 3 * kB * clampT(temp)); // adaptive window

          const zoomRaw = dos.filter(d => (
            Math.abs(d.E - Ec) < dE || Math.abs(d.E - Ev) < dE
          ));

          // true autoscale → NO normalization
          const zoomData = zoomRaw;

          return (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={zoomData}>
                <CartesianGrid stroke="#444" />
                <XAxis dataKey="E" />
                <YAxis domain={["auto","auto"]} allowDecimals={true} />
                <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
                <ReferenceLine x={Ec} stroke="#00ffcc" />
                <ReferenceLine x={Ev} stroke="#00ccff" />
                <Area dataKey="n" fill="#ff4d4d" fillOpacity={0.6} />
                <Area dataKey="p" fill="#4da6ff" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          );
        })()}

        {/* --- temperature dependence --- */}
        <h3 className="mt-6">Temperature dependence of carriers</h3>
        <p className="text-sm text-gray-400 mb-2">→ Shows exponential increase: n ∝ exp(-Eg / 2kT)</p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={tempSweep}>
            <CartesianGrid stroke="#444" />
            <XAxis dataKey="T" />
            <YAxis domain={["auto","auto"]} allowDecimals={true} />
            <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
            <Legend />
            <Line dataKey="n" name="electrons n(T)" dot={false} />
            <Line dataKey="p" name="holes p(T)" dot={false} />
          </LineChart>
        </ResponsiveContainer>

        {/* --- Arrhenius plot --- */}
        <div className="bg-gray-900 rounded-2xl p-4 shadow-lg mt-6">
        <h3 className="text-lg font-semibold mb-2">Arrhenius Plot</h3>
        <p className="text-sm text-gray-400 mb-2">→ Straight line: slope = -Eg / (2kB)</p>
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          <div className="text-red-400 font-mono">
            ln n = −E<sub>g</sub>/(2k<sub>B</sub>) · (1/T)
          </div>
          <div className="text-blue-400 font-mono">
            ln p = −E<sub>g</sub>/(2k<sub>B</sub>) · (1/T)
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={tempSweep}>
            <CartesianGrid stroke="#444" />
            <XAxis xAxisId="bottom" dataKey="invT" name="1/T" type="number" domain={["auto", "auto"]} reversed tickFormatter={(v) => v.toExponential(1)} label={{ value: "1/T (1/K)", position: "insideBottomRight", offset: -5 }} />
            <XAxis xAxisId="top" dataKey="invT" orientation="top" type="number" domain={["auto", "auto"]} reversed tickFormatter={(v) => (1/v).toFixed(0)} label={{ value: "T (K)", position: "insideTopRight", offset: 5 }} />
            <YAxis />
            <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
            <Legend />
            <Line dataKey="ln_n" name="ln n" dot={false} xAxisId="bottom" />
            <Line dataKey="ln_p" name="ln p" dot={false} xAxisId="bottom" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      </div>
      </div>
      )}

      {tab === "optics" && (
      <div>

      {/* Exciton controls */}
      <div className="mb-4 flex items-center gap-4">
        <div>
          <label className="mr-2">Exciton type:</label>
          <select value={excitonType} onChange={(e)=>setExcitonType(e.target.value)} className="text-black">
            <option value="Wannier">Wannier (delocalized)</option>
            <option value="Frenkel">Frenkel (localized)</option>
          </select>
        </div>

        {/* visual explanation */}
        <div className="text-sm text-gray-400">
          {excitonType === "Wannier" 
            ? "Hydrogen-like series → many sharp peaks"
            : "Localized exciton → single broad peak"}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div>
          <label>Exciton binding E_B: {Eb.toFixed(3)} eV</label>
          <input type="range" min="0.005" max="0.2" step="0.005" value={Eb}
            onChange={(e) => setEb(parseFloat(e.target.value))} />
        </div>
        <div>
          
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2>Absorption</h2>
          <p className="text-sm text-gray-400 mb-1">Excitons below Eg, continuum above Eg</p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={absorption}>
              <CartesianGrid stroke="#444" />
              <XAxis dataKey="E" label={{ value: "Energy (eV)", position: "insideBottomRight", offset: -5 }} />
              <YAxis domain={[0, 'auto']} label={{ value: "Intensity (arb.)", angle: -90, position: "insideLeft" }} />
              <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
              <ReferenceLine x={Eg} label={{ value: "Eg", fill: "white" }} />
              <ReferenceLine x={Eg - Eb} stroke="yellow" label={{ value: "1s", fill: "yellow" }} />

              {/* Rydberg labels */}
              {excitonType === "Wannier" && Array.from({ length: nMax }, (_, i) => {
                const n = i + 1;
                const En = Eg - Eb / (n * n);
                return (
                  <ReferenceLine
                    key={`rydberg-${n}`}
                    x={En}
                    stroke="rgba(255,255,0,0.4)"
                    label={{ value: `n=${n}`, fill: 'yellow', position: 'top' }}
                  />
                );
              })}

              {excitonType === "Frenkel" && (
                <ReferenceLine
                  x={Eg - Eb}
                  stroke="yellow"
                  strokeWidth={3}
                  label={{ value: "Frenkel exciton", fill: 'yellow', position: 'top' }}
                />
              )}

              <Line dataKey="alpha" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <h2>Photoluminescence</h2>
          <p className="text-sm text-gray-400 mb-1">Emission: exciton peak (Eg-Eb) + band-edge recombination</p>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={pl}>
              <CartesianGrid stroke="#444" />
              <XAxis dataKey="E" label={{ value: "Energy (eV)", position: "insideBottomRight", offset: -5 }} />
              <YAxis domain={[0, 'auto']} label={{ value: "Intensity (arb.)", angle: -90, position: "insideLeft" }} />
              <Tooltip formatter={(v) => (v != null ? Number(v).toExponential(2) : "0")} />
              <ReferenceLine x={Eg} label={{ value: "Eg", fill: "white" }} />
              <ReferenceLine x={Eg - Eb} stroke="yellow" label={{ value: "1s", fill: "yellow" }} />

              {/* Rydberg labels */}
              {excitonType === "Wannier" && Array.from({ length: nMax }, (_, i) => {
                const n = i + 1;
                const En = Eg - Eb / (n * n);
                return (
                  <ReferenceLine
                    key={`rydberg-${n}`}
                    x={En}
                    stroke="rgba(255,255,0,0.4)"
                    label={{ value: `n=${n}`, fill: 'yellow', position: 'top' }}
                  />
                );
              })}

              {excitonType === "Frenkel" && (
                <ReferenceLine
                  x={Eg - Eb}
                  stroke="yellow"
                  strokeWidth={3}
                  label={{ value: "Frenkel exciton", fill: 'yellow', position: 'top' }}
                />
              )}

              <Line dataKey="I" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <div>
          <h3>Physics</h3>
          <p>Eg(T): {Eg.toFixed(2)} eV</p>
          <p>nᵢ(T): {ni.toExponential(2)}</p>
        </div>

        <div>
          <h3>Optics</h3>
          <p className="text-sm text-gray-400">Direct: strong radiative recombination (LEDs)</p>
          <p className="text-sm text-gray-400">Indirect: phonon-assisted (weak PL)</p>
          <p>{direct ? "Strong PL" : "Weak PL (phonon-assisted)"}</p>
        </div>

        <div>
          <h3>Device Applications 🎯</h3>
          <select value={challenge} onChange={(e) => setChallenge(e.target.value)} className="text-black">
            <option value="none">None</option>
            <option value="LED">LED</option>
            <option value="Solar">Solar</option>
            <option value="Detector">Detector</option>
          </select>

          {challenge !== "none" && (
            <div className="mt-3">
              <div className="w-full bg-gray-700 h-3 rounded">
                <div
                  className={`h-3 rounded ${color === "green" ? "bg-green-500" : color === "yellow" ? "bg-yellow-400" : "bg-red-500"}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <p>Score: {score}</p>
              <p>{feedback}</p>
            </div>
          )}
        </div>
      </div>
      </div>
      )}      </div>
  );
}
