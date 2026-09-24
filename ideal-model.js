/* Five equal series-R / shunt-C sections; periodic ideal steps, SI internally. */
const IdealModel = (() => {
  const PWRC = [1.2, 1, .9, .8, .6, .5, .45, .4];
  const DBC = [
    { code: '00', ratio: 5, lowUA: 12, highUA: 60 },
    { code: '01', ratio: 3, lowUA: 20, highUA: 60 },
    { code: '10', ratio: 9, lowUA: 6.7, highUA: 60 },
    { code: '11', ratio: 7, lowUA: 8.5, highUA: 60 }
  ];
  // Slide-derived calibration knobs. These are deliberately exposed in the UI
  // until measured ΔV tables are available for each silicon mode.
  const DELTA_CAL = {
    sreReduction: .12,
    dbcReduction: .10,
    pwrcReduction: .10,
    heavyLoadSensitivity: .55,
    minFactor: .35,
    sreBiasMultiplier: 1.25
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  // Jacobi eigendecomposition of the real symmetric RC decay matrix.
  function eigen(matrix) {
    const a = matrix.map(r => [...r]), n = a.length;
    const q = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
    for (let iter = 0; iter < 300; iter++) {
      let p = 0, r = 1, largest = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; r = j; }
      }
      const scale = Math.max(...a.map((row, i) => Math.abs(row[i])));
      if (largest <= scale * 1e-14) break;
      const theta = .5 * Math.atan2(2 * a[p][r], a[r][r] - a[p][p]);
      const c = Math.cos(theta), s = Math.sin(theta);
      const pp = a[p][p], rr = a[r][r], pr = a[p][r];
      a[p][p] = c*c*pp - 2*s*c*pr + s*s*rr;
      a[r][r] = s*s*pp + 2*s*c*pr + c*c*rr;
      a[p][r] = a[r][p] = 0;
      for (let k = 0; k < n; k++) {
        if (k !== p && k !== r) {
          const kp = a[k][p], kr = a[k][r];
          a[k][p] = a[p][k] = c*kp - s*kr;
          a[k][r] = a[r][k] = s*kp + c*kr;
        }
        const qp = q[k][p], qr = q[k][r];
        q[k][p] = c*qp - s*qr; q[k][r] = s*qp + c*qr;
      }
    }
    const lambda = a.map((r, i) => r[i]);
    if (lambda.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('RC 條件超出可計算範圍。');
    return { lambda, q };
  }
  function path({ panelR, panelC, routsw, resd, rwoa, deltaV, lineTime }) {
    const n = 5, rs = panelR / n, cs = panelC * 1e-12 / n;
    const chipR = routsw + resd, firstR = chipR + rwoa + rs;
    const g = 1 / rs, g0 = 1 / firstR;
    const matrix = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      matrix[i][i] = ((i === 0 ? g0 : g) + (i < n - 1 ? g : 0)) / cs;
      if (i < n - 1) matrix[i][i+1] = matrix[i+1][i] = -g / cs;
    }
    const { lambda, q } = eigen(matrix);
    // In periodic steady state, each eigenmode has residual 1/(1+exp(-lambda*L)).
    const coeff = lambda.map((l, j) => q.reduce((sum, row) => sum + row[j], 0) / (1 + Math.exp(-l * lineTime)));
    const modes = q.map(row => row.map((v, j) => v * coeff[j]));
    const currentModes = modes[0].map(v => deltaV * v / firstR);
    function integralSquared(weights) {
      let sum = 0;
      for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        const decay = lambda[j] + lambda[k];
        sum += weights[j] * weights[k] * -Math.expm1(-decay * lineTime) / decay;
      }
      return Math.max(0, sum);
    }
    const currentIntegral = integralSquared(currentModes);
    const energyJ = chipR * currentIntegral;
    let panelEnergyJ = rs * currentIntegral;
    for (let i = 1; i < n; i++) {
      const branch = modes[i].map((v,j) => deltaV * (v - modes[i-1][j]) / rs);
      panelEnergyJ += rs * integralSquared(branch);
    }
    const residual = (node,t) => modes[node].reduce((sum,v,j) => sum+v*Math.exp(-lambda[j]*t),0);
    return {
      energyJ, averageMW: energyJ / lineTime * 1000,
      externalEnergyJ: panelEnergyJ + rwoa * currentIntegral,
      slowTau: 1 / Math.min(...lambda), fastTau: 1 / Math.max(...lambda),
      settleError: residual(n-1,lineTime),
      powerMW(t) { const i = currentModes.reduce((sum,v,j) => sum+v*Math.exp(-lambda[j]*t),0); return i*i*chipR*1000; },
      fraction(t) { return 1-residual(n-1,t); }
    };
  }
  function calculate(d) {
    const lineTime = 1 / (d.frameRate * d.resH);
    const blankTime = d.blankUS * 1e-6;
    if (!(lineTime > blankTime)) throw new Error('Line time 必須大於 blanking time。');
    if (d.channels % 2) throw new Error('Channel Number 必須為偶數，P／N 各半。');
    const ratio = PWRC[d.pwrc], entry = DBC[d.dbcDrv];
    const activeTime = lineTime-blankTime;
    const boostTime = d.dbcEnabled ? Math.min(d.dbcDuty/100*lineTime, activeTime) : 0;
    const biasTime = d.blankBiasOff ? activeTime : lineTime;
    const dbcActivity = d.dbcEnabled ? boostTime/lineTime : 0;
    const sreEnabled = Boolean(d.sreEnabled);
    const pwrcReduction = (d.pwrcDeltaReduction == null ? DELTA_CAL.pwrcReduction : d.pwrcDeltaReduction/100) * clamp((1-ratio)/.6, 0, 1);
    const dbcReduction = (d.dbcDeltaReduction == null ? DELTA_CAL.dbcReduction : d.dbcDeltaReduction/100) * dbcActivity * (entry.ratio/9);
    const sreReduction = sreEnabled ? (d.sreDeltaReduction == null ? DELTA_CAL.sreReduction : d.sreDeltaReduction/100) : 0;
    const loadRatio = Math.sqrt((d.panelR*d.panelC*1e-12)/(3000*200e-12));
    const loadSeverity = clamp(loadRatio-1, 0, 2);
    const loadMultiplier = 1 + (d.heavyLoadSensitivity ?? DELTA_CAL.heavyLoadSensitivity)*loadSeverity;
    const rawReduction = (pwrcReduction + dbcReduction + sreReduction) * loadMultiplier;
    const deltaFactor = clamp(1-rawReduction, DELTA_CAL.minFactor, 1);
    const effectiveDeltaVP = d.deltaVP*deltaFactor;
    const effectiveDeltaVN = d.deltaVN*deltaFactor;
    const base = { panelR:d.panelR, panelC:d.panelC, resd:d.resd, rwoa:d.rwoa, lineTime };
    const p = path({ ...base, routsw:d.routswP, deltaV:effectiveDeltaVP });
    const n = path({ ...base, routsw:d.routswN, deltaV:effectiveDeltaVN });
    const acP = p.averageMW*d.channels/2, acN = n.averageMW*d.channels/2;
    const ac = acP+acN, fixedDC = d.fixedMA*d.fixedV;
    // OP supply current baseline is 7 uA at PWRC=100%; the table supplies boost ratios.
    const sreBiasMultiplier = sreEnabled ? (d.sreBiasMultiplier ?? DELTA_CAL.sreBiasMultiplier) : 1;
    const lowMA = d.opUA*ratio*d.channels*sreBiasMultiplier/1000;
    const highMA = lowMA*entry.ratio;
    const sourceDC = d.sourceV*(lowMA*(biasTime-boostTime)+highMA*boostTime)/lineTime;
    const referenceSourceDC = d.sourceV*(d.opUA*ratio*d.channels/1000);
    const dcIncreasePercent = referenceSourceDC > 0 ? (sourceDC-referenceSourceDC)/referenceSourceDC*100 : 0;
    const dc = fixedDC+sourceDC;
    const total = ac+dc;
    const temperature = d.xBase !== null && d.ySlope !== null ? d.xBase+d.ySlope*total : null;
    if (![ac,dc,total,temperature??0].every(Number.isFinite)) throw new Error('輸入數值過大，請降低參數範圍。');
    return { p,n,acP,acN,ac,fixedDC,sourceDC,dc,total,temperature,lineTime,activeTime,boostTime,ratio,entry,
      baseDeltaVP:d.deltaVP, baseDeltaVN:d.deltaVN, effectiveDeltaVP, effectiveDeltaVN,
      deltaFactor, deltaReduction:1-deltaFactor, acReductionPercent:(1-deltaFactor*deltaFactor)*100,
      loadRatio, loadSeverity, loadMultiplier, pwrcReduction, dbcReduction, sreReduction, rawReduction,
      dbcActivity, sreEnabled, sreBiasMultiplier, lowMA, highMA, referenceSourceDC, dcIncreasePercent,
      dcAt(t) {
        const mA = d.blankBiasOff && t>=activeTime ? 0 : (t<boostTime ? highMA : lowMA);
        return fixedDC+d.sourceV*mA;
      }
    };
  }
  return { PWRC, DBC, path, calculate };
})();
if (typeof module !== 'undefined') module.exports = IdealModel;
