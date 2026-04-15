async function reactLoop(chatId,userMsg){
let thoughts=[];
let iterations=0;
const MAX=5;
thoughts.push({role:"user",content:userMsg});
while(iterations<MAX){
iterations++;
const sys="You are IBIS. Think step by step. If you need to search the web write ACTION: search(<query>). If you have a final answer write FINAL: <answer>";
const res=await callModel("default",thoughts,sys);
thoughts.push({role:"assistant",content:res});
if(res.includes("FINAL:")){
const answer=res.split("FINAL:")[1].trim();
await bot.sendMessage(chatId,answer);
return;
}
if(res.includes("ACTION: search(")){
const q=res.split("ACTION: search(")[1].split(")")[0];
await bot.sendMessage(chatId,"Searching: "+q);
const results=await webSearch(q);
thoughts.push({role:"user",content:"OBSERVATION: "+results});
}
}
await bot.sendMessage(chatId,"Task complete.");
}
