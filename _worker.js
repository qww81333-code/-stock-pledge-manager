function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });
}
function num(v){
  if(v===null || v===undefined) return NaN;
  const s=String(v).replace(/,/g,"").trim();
  if(!s || s==="-" || s==="--") return NaN;
  const x=Number(s);
  return Number.isFinite(x)?x:NaN;
}
function cleanCode(v){
  const s=String(v||"").trim().toUpperCase();
  return /^[0-9A-Z]{4,7}$/.test(s)?s:"";
}
function firstPrice(s){
  if(!s) return NaN;
  const first=String(s).split("_").find(x=>Number.isFinite(num(x)));
  return num(first);
}
async function misQuote(code){
  const channels=`tse_${code}.tw|otc_${code}.tw`;
  const api=`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0&_=${Date.now()}`;
  const r=await fetch(api,{
    headers:{
      "accept":"application/json,text/plain,*/*",
      "user-agent":"Mozilla/5.0",
      "referer":"https://mis.twse.com.tw/stock/index.jsp"
    }
  });
  if(!r.ok) throw new Error(`MIS HTTP ${r.status}`);
  const data=await r.json();
  const list=Array.isArray(data.msgArray)?data.msgArray:[];
  const q=list.find(x=>String(x.c||"").toUpperCase()===code && (x.ex==="tse"||x.ex==="otc"))
       || list.find(x=>String(x.c||"").toUpperCase()===code);
  if(!q) throw new Error("MIS 查無此代碼");

  let price=num(q.z);
  let priceType="最近成交價";
  if(!Number.isFinite(price)){
    const bid=firstPrice(q.b), ask=firstPrice(q.a);
    if(Number.isFinite(bid) && Number.isFinite(ask)){ price=(bid+ask)/2; priceType="無成交時買賣中間價"; }
    else if(Number.isFinite(bid)){ price=bid; priceType="無成交時最佳買價"; }
    else if(Number.isFinite(ask)){ price=ask; priceType="無成交時最佳賣價"; }
  }
  if(!Number.isFinite(price)) throw new Error("目前沒有可用成交價格");

  const d=String(q.d||"");
  const date=d.length===8?`${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`:d;
  const time=String(q.t||"");
  return {
    ok:true, code, name:q.n||q.nf||code, fullName:q.nf||"",
    price, priceType, exchange:q.ex==="otc"?"上櫃":"上市",
    date, time, displayTime:[date,time].filter(Boolean).join(" "),
    source:"TWSE_MIS", sourceLabel:`證交所 MIS・${priceType}`
  };
}
async function twseClose(code){
  const r=await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",{
    headers:{"accept":"application/json","user-agent":"Mozilla/5.0"}
  });
  if(!r.ok) throw new Error(`TWSE OpenAPI HTTP ${r.status}`);
  const rows=await r.json();
  const row=(Array.isArray(rows)?rows:[]).find(x=>String(
    x.Code ?? x.code ?? x["證券代號"] ?? x["股票代號"] ?? ""
  ).trim().toUpperCase()===code);
  if(!row) throw new Error("TWSE OpenAPI 查無此代碼");
  const price=num(row.ClosingPrice ?? row.Close ?? row.close ?? row["收盤價"]);
  if(!Number.isFinite(price)) throw new Error("TWSE OpenAPI 無收盤價");
  const name=row.Name ?? row.name ?? row["證券名稱"] ?? row["股票名稱"] ?? code;
  const date=row.Date ?? row.date ?? row["日期"] ?? "";
  return {ok:true,code,name,price,priceType:"最新官方收盤價",exchange:"上市",
    date:String(date),time:"",displayTime:String(date||"最近交易日"),
    source:"TWSE_OPENAPI",sourceLabel:"證交所 OpenAPI・最新收盤價"};
}
async function tpexClose(code){
  const r=await fetch("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes",{
    headers:{"accept":"application/json","user-agent":"Mozilla/5.0"}
  });
  if(!r.ok) throw new Error(`TPEx OpenAPI HTTP ${r.status}`);
  const rows=await r.json();
  const row=(Array.isArray(rows)?rows:[]).find(x=>String(
    x.SecuritiesCompanyCode ?? x.Code ?? x.code ?? x["證券代號"] ?? x["股票代號"] ?? ""
  ).trim().toUpperCase()===code);
  if(!row) throw new Error("TPEx OpenAPI 查無此代碼");
  const price=num(row.Close ?? row.ClosingPrice ?? row.close ?? row["收盤價"]);
  if(!Number.isFinite(price)) throw new Error("TPEx OpenAPI 無收盤價");
  const name=row.CompanyName ?? row.Name ?? row.name ?? row["證券名稱"] ?? row["股票名稱"] ?? code;
  const date=row.Date ?? row.date ?? row["日期"] ?? "";
  return {ok:true,code,name,price,priceType:"最新官方收盤價",exchange:"上櫃",
    date:String(date),time:"",displayTime:String(date||"最近交易日"),
    source:"TPEX_OPENAPI",sourceLabel:"櫃買中心 OpenAPI・最新收盤價"};
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/api/quote"){
      const code=cleanCode(url.searchParams.get("code"));
      if(!code) return json({ok:false,error:"股票代碼格式不正確"},400);

      const errors=[];
      try { return json(await misQuote(code)); }
      catch(e){ errors.push(e?.message||String(e)); }

      try { return json(await twseClose(code)); }
      catch(e){ errors.push(e?.message||String(e)); }

      try { return json(await tpexClose(code)); }
      catch(e){ errors.push(e?.message||String(e)); }

      return json({ok:false,error:"找不到此代碼的可用行情",detail:errors.slice(0,3)},404);
    }

    return env.ASSETS.fetch(request);
  }
};