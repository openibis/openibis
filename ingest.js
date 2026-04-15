async function ingestURL(url,room){
const content=await browserVisit(url);
const key="ingest::"+url.slice(0,50);
db.prepare("INSERT INTO knowledge(key,value,created_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,content,Date.now());
return "Ingested and stored in palace: "+url;
}
