const BASE="http://127.0.0.1:4001",OUTLET="a0deb015-8ef8-4ef5-aac7-6e91c9da6b5b";let TOK="";
const H=()=>({"Content-Type":"application/json",Authorization:`Bearer ${TOK}`,"X-Outlet-Id":OUTLET});
const j=async(m,p,b)=>{const r=await fetch(`${BASE}${p}`,{method:m,headers:H(),body:b?JSON.stringify(b):undefined});let d;const t=await r.text();try{d=JSON.parse(t)}catch{d=t}return{status:r.status,data:d};};
const kots=async(oid)=>{const k=await j("GET",`/kitchen/kot?orderId=${oid}`);const a=Array.isArray(k.data)?k.data:(k.data.tickets||[]);return a.filter(x=>x.orderId===oid);};
(async()=>{
  TOK=(await (await fetch(`${BASE}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:"admin@restaurant.com",password:"admin123",outletId:OUTLET})})).json()).accessToken;
  const menu=await j("GET","/menu/items");const items=(Array.isArray(menu.data)?menu.data:(menu.data.items||[])).filter(i=>i.priceMinor||i.price);
  const tbls=await j("GET","/tables");const tarr=Array.isArray(tbls.data)?tbls.data:(tbls.data.tables||[]);
  const T=tarr.find(t=>(t.status==="VACANT"||t.status==="AVAILABLE")&&!t.currentOrder&&!t.mergeGroupId);
  const c=await j("POST","/orders",{action:"KOT",diningTableId:T.id,tableNumber:T.tableNumber,orderType:"DINE_IN",items:[{itemId:items[0].id,quantity:1}]});
  const oid=c.data.id;console.log("create",c.status,"oid",oid,"kots",(await kots(oid)).length);
  const add=await j("POST",`/orders/${oid}/items`,{lines:[{menuItemId:items[1].id,quantity:1}]});
  console.log("add(lines)",add.status);
  const k=await kots(oid);console.log("kots after add (expect 2):",k.length,k.map(x=>x.status));
  // cleanup: settle so table frees
  const bill=await j("GET",`/orders/${oid}/bill`);const due=Number(bill.data.dueMinor||0);
  const s=await j("POST",`/orders/${oid}/settle`,{paymentMethod:"CASH",amountPaidMinor:due});
  console.log("cleanup settle",s.status,s.data);
})();
