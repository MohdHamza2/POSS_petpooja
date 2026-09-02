// Wave 2 + gap probe: add-items->new KOT, vacate-unpaid 409, merge, split payments[], shift reconciliation.
const BASE = "http://127.0.0.1:4001";
const OUTLET = "a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";
let TOK = "";
function H(){return{"Content-Type":"application/json",Authorization:`Bearer ${TOK}`,"X-Outlet-Id":OUTLET};}
async function j(m,p,b){const r=await fetch(`${BASE}${p}`,{method:m,headers:H(),body:b?JSON.stringify(b):undefined});let d;const t=await r.text();try{d=JSON.parse(t)}catch{d=t}return{status:r.status,data:d};}
function log(l,o){console.log(`\n### ${l}`);console.log(typeof o==="string"?o:JSON.stringify(o,null,2));}
const kots=async(oid)=>{const k=await j("GET",`/kitchen/kot?orderId=${oid}`);const a=Array.isArray(k.data)?k.data:(k.data.tickets||k.data.kots||[]);return a.filter(x=>x.orderId===oid||(x.order&&x.order.id===oid));};

(async()=>{try{
  const lr=await fetch(`${BASE}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"admin@restaurant.com",password:"admin123",outletId:OUTLET})});
  TOK=(await lr.json()).accessToken; if(!TOK){console.log("LOGIN FAIL");return;}

  const menu=await j("GET","/menu/items");
  const items=(Array.isArray(menu.data)?menu.data:(menu.data.items||[])).filter(i=>i.priceMinor||i.price);
  const A=items[0], B=items[1]||items[0];

  const tbls=await j("GET","/tables");
  const tarr=Array.isArray(tbls.data)?tbls.data:(tbls.data.tables||[]);
  const vac=tarr.filter(t=>(t.status==="VACANT"||t.status==="AVAILABLE")&&!t.currentOrder&&!t.mergeGroupId);
  const T1=vac[0], T2=vac[1];
  log("picked tables",{T1:T1&&T1.tableNumber,T2:T2&&T2.tableNumber});

  // A) place KOT on T1
  const c1=await j("POST","/orders",{action:"KOT",diningTableId:T1.id,tableNumber:T1.tableNumber,orderType:"DINE_IN",items:[{itemId:A.id,quantity:1}]});
  const oid=c1.data.id; log("A create KOT T1",{status:c1.status,oid,ost:c1.data.status});
  const k1=await kots(oid); log("A KOT tickets",k1.map(k=>({id:k.id,status:k.status})));

  // B) add items -> should create a NEW kot for new lines
  const add=await j("POST",`/orders/${oid}/items`,{items:[{itemId:B.id,quantity:1}]});
  log("B add items",{status:add.status});
  const k2=await kots(oid); log("B KOT tickets after add (expect 2)",{count:k2.length,tickets:k2.map(k=>({id:k.id,status:k.status}))});

  // C) vacate unpaid -> expect 409
  const vacUnpaid=await j("POST",`/tables/${T1.id}/vacant`,{});
  log("C vacate UNPAID (expect 409)",{status:vacUnpaid.status,data:vacUnpaid.data&&(vacUnpaid.data.error||vacUnpaid.data)});

  // D) SPLIT settle via payments[] (Wave 3 backend support check)
  const bill=await j("GET",`/orders/${oid}/bill`);
  const due=Number(bill.data.dueMinor||bill.data.grandTotalMinor||0);
  const half=Math.floor(due/2);
  const split=await j("POST",`/orders/${oid}/settle`,{payments:[{method:"CASH",amountMinor:half},{method:"UPI",amountMinor:due-half}]});
  log("D split settle payments[]",{status:split.status,due,data:split.data&&(split.data.error||split.data.invoiceNumber||split.data)});

  // E) merge two fresh tables: place KOT on T2, then merge T2 into a 3rd
  const T3=vac[2];
  const c2=await j("POST","/orders",{action:"KOT",diningTableId:T2.id,tableNumber:T2.tableNumber,orderType:"DINE_IN",items:[{itemId:A.id,quantity:1}]});
  log("E create KOT T2",{status:c2.status,oid:c2.data.id});
  if(T3){
    const merge=await j("POST","/tables/merge",{sourceTableIds:[T3.id],targetTableId:T2.id,primaryTableId:T2.id,tableIds:[T2.id,T3.id]});
    log("E merge T3->T2",{status:merge.status,data:merge.data&&(merge.data.error||merge.data.mergeGroupId||merge.data)});
    const tb2=await j("GET","/tables");
    const ta2=Array.isArray(tb2.data)?tb2.data:(tb2.data.tables||[]);
    const m3=ta2.find(t=>t.id===T3.id), m2=ta2.find(t=>t.id===T2.id);
    log("E tables after merge",{T2:{status:m2&&m2.status,mg:m2&&m2.mergeGroupId},T3:{status:m3&&m3.status,mg:m3&&m3.mergeGroupId}});
  }

  // F) shift reconciliation scoping
  const rec=await j("GET","/waiters/me/shift-reconciliation");
  log("F shift reconciliation",{status:rec.status,keys:rec.data&&Object.keys(rec.data),totals:rec.data&&(rec.data.totals||rec.data.summary)});

  // G) notifications real vs hardcoded
  const notif=await j("GET","/notifications");
  log("G notifications",{status:notif.status,count:Array.isArray(notif.data)?notif.data.length:(notif.data.notifications?notif.data.notifications.length:"?")});

  console.log("\n=== WAVE2 PROBE DONE ===");
}catch(e){console.log("ERR",e&&e.stack||String(e));}})();
