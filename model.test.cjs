const assert = require('node:assert/strict');
const M = require('./model.cjs');
const close = (a,b,rel=1e-8) => assert.ok(Math.abs(a-b)<=Math.max(Math.abs(a),Math.abs(b),1e-18)*rel, `${a} != ${b}`);
const pathInput = {panelR:3000,panelC:200,routsw:600,resd:100,rwoa:1,deltaV:8.6,lineTime:1/64800};
const p=M.path(pathInput);
// All resistor heat equals half C deltaV squared after a fully settled step.
close(p.energyJ+p.externalEnergyJ,.5*200e-12*8.6**2);
close(M.path({...pathInput,deltaV:17.2}).energyJ,4*p.energyJ);
close(M.path({...pathInput,deltaV:0}).energyJ,0);
close(M.path({...pathInput,routsw:0,resd:0}).energyJ,0);
// Independent time-domain RK4 reference; settle for at least 40 slow time constants.
function reference(o){
  const rs=o.panelR/5, c=o.panelC*1e-12/5, r0=o.routsw+o.resd+o.rwoa+rs;
  const dt=Math.min(rs,r0)*c/40, count=Math.ceil(o.lineTime/dt), h=o.lineTime/count;
  const deriv=(v,u)=>v.map((x,i)=>((i===0?(u-x)/r0:(v[i-1]-x)/rs)-(i===4?0:(x-v[i+1])/rs))/c);
  let v=Array(5).fill(0), energy;
  const cycles=Math.max(16,2*Math.ceil(40*(o.routsw+o.resd+o.rwoa+o.panelR)*o.panelC*1e-12/o.lineTime/2));
  for(let cycle=0;cycle<cycles;cycle++){
    const u=cycle%2===0?o.deltaV:0; energy=0;
    const power=v=>((u-v[0])/r0)**2*(o.routsw+o.resd);
    for(let step=0;step<count;step++){
      const k1=deriv(v,u), a=v.map((x,i)=>x+h*k1[i]/2), k2=deriv(a,u);
      const b=v.map((x,i)=>x+h*k2[i]/2), k3=deriv(b,u);
      const cstate=v.map((x,i)=>x+h*k3[i]), k4=deriv(cstate,u);
      energy+=h/6*(power(v)+2*power(a)+2*power(b)+power(cstate));
      v=v.map((x,i)=>x+h/6*(k1[i]+2*k2[i]+2*k3[i]+k4[i]));
    }
  }
  return energy;
}
close(p.energyJ,reference(pathInput),1e-6);
const short={...pathInput,lineTime:2e-7};
close(M.path(short).energyJ,reference(short),2e-6);
const d={panelR:3000,panelC:200,routswP:600,routswN:600,resd:100,rwoa:1,deltaVP:8.6,deltaVN:8.6,channels:960,frameRate:60,resH:1080,blankUS:.2,pwrc:4,dbcDrv:0,dbcEnabled:true,dbcDuty:10,blankBiasOff:false,opUA:7,sourceV:18,fixedMA:3,fixedV:18,xBase:25,ySlope:.08};
const r=M.calculate(d);
close(r.ac,960*p.averageMW); close(r.fixedDC,54);
close(r.sourceDC,18*960*.6*7*(.9+.1*5)/1000);
close(r.total,r.ac+r.dc);close(r.temperature,25+.08*r.total);
close(M.calculate({...d,dbcDuty:0}).sourceDC,18*960*.6*7/1000);
close(M.calculate({...d,dbcEnabled:false}).sourceDC,18*960*.6*7/1000);
close(M.calculate({...d,pwrc:0}).sourceDC,2*r.sourceDC);
close(M.calculate({...d,frameRate:120}).sourceDC,r.sourceDC);
close(M.calculate({...d,channels:1920}).ac,2*r.ac);
for(let i=0;i<4;i++) close(M.calculate({...d,dbcDrv:i}).sourceDC,18*960*.6*7*(.9+.1*[5,3,9,7][i])/1000);
close(r.dcAt(r.lineTime),54+18*960*.6*7/1000);
close(M.calculate({...d,blankBiasOff:true}).sourceDC,r.sourceDC-18*960*.6*7/1000*.2e-6/r.lineTime);
assert.equal(M.calculate({...d,xBase:null}).temperature,null);
assert.throws(()=>M.calculate({...d,channels:961}));
assert.throws(()=>M.calculate({...d,blankUS:20}));
assert.deepEqual(M.DBC.map(x=>x.lowUA),[12,20,6.7,8.5]);
console.log('PASS: energy conservation, independent RK4 (settled and partial), voltage squared, zero loss, channel scaling, bias ratios/duty, fixed power, pending calibration, invalid timing.');
console.log(JSON.stringify({ACP_mW:r.p.averageMW,ACN_mW:r.n.averageMW,AC_mW:r.ac,otherDC_mW:r.fixedDC,sourceDC_example_mW:r.sourceDC}));
