
const express=require("express"),http=require("http"),{WebSocketServer}=require("ws"),crypto=require("crypto");
const app=express(),server=http.createServer(app),wss=new WebSocketServer({server,path:'/ws'});app.use(express.static(__dirname+"/public"));
const rooms=new Map(),colors=["red","yellow","green","blue"],actions=["skip","reverse","draw2"];
const id=()=>crypto.randomBytes(5).toString("hex");
const card=(c,v)=>({c,v,id:id()});
function shuffle(a){for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function deck(){let d=[];for(const c of colors){d.push(card(c,"0"));for(let i=1;i<10;i++)d.push(card(c,""+i),card(c,""+i));for(const a of actions)d.push(card(c,a),card(c,a))}for(let i=0;i<4;i++)d.push(card("wild","wild"),card("wild","draw4"));return shuffle(d)}
function send(p,x){if(p.ws?.readyState===1)p.ws.send(JSON.stringify(x))}
function broadcast(r){r.players.forEach(p=>send(p,{type:"state",room:r.code,host:r.host,started:r.started,winner:r.winner,current:r.current,currentColor:r.currentColor,direction:r.direction,pendingDraw:r.pendingDraw,top:r.discard.at(-1),you:p.id,players:r.players.map(q=>({id:q.id,name:q.name,count:q.hand.length,connected:!!q.ws})),hand:p.hand}))}
function recycle(r){if(r.discard.length<=1)return;const t=r.discard.pop();r.deck=shuffle(r.discard);r.discard=[t]}
function draw(r){if(!r.deck.length)recycle(r);return r.deck.pop()}
function next(r){r.current=(r.current+r.direction+r.players.length)%r.players.length}
function valid(r,c){let t=r.discard.at(-1);return r.pendingDraw?c.v==="draw2"||c.v==="draw4":c.c==="wild"||c.c===r.currentColor||c.v===t.v}
function start(r){if(r.players.length<2)return; r.deck=deck();r.discard=[];r.current=0;r.direction=1;r.currentColor=null;r.pendingDraw=0;r.winner=null;r.players.forEach(p=>p.hand=[]);for(let i=0;i<7;i++)r.players.forEach(p=>p.hand.push(draw(r)));let f=draw(r);while(f.c==="wild"){r.deck.unshift(f);f=draw(r)}r.discard=[f];r.currentColor=f.c;r.started=true;broadcast(r)}
function end(r,p){r.winner=p.id;r.started=false;broadcast(r)}
wss.on("connection",ws=>{let p=null,r=null;
 ws.on("message",raw=>{let m;try{m=JSON.parse(raw)}catch{return}
 if(m.type==="create"){let code=Math.random().toString(36).slice(2,7).toUpperCase();r={code,players:[],host:null,started:false,winner:null,current:0,currentColor:null,direction:1,pendingDraw:0,deck:[],discard:[]};rooms.set(code,r);p={id:id(),name:String(m.name||"Player").slice(0,20),hand:[],ws};r.players.push(p);r.host=p.id;send(p,{type:"joined",code,playerId:p.id});broadcast(r)}
 else if(m.type==="join"){r=rooms.get(String(m.code||"").toUpperCase());if(!r)return send({ws}, {type:"error",message:"Room not found"});if(r.started)return send({ws},{type:"error",message:"Game already started"});if(r.players.length>=4)return send({ws},{type:"error",message:"Room is full"});p={id:id(),name:String(m.name||"Player").slice(0,20),hand:[],ws};r.players.push(p);send(p,{type:"joined",code:r.code,playerId:p.id});broadcast(r)}
 else if(!p||!r)return;
 else if(m.type==="start"&&p.id===r.host)start(r);
 else if(m.type==="play"&&r.started&&r.players[r.current].id===p.id){let i=p.hand.findIndex(c=>c.id===m.cardId);if(i<0)return;let c=p.hand[i];if(!valid(r,c))return send(p,{type:"error",message:"Card cannot be played"});if(c.c==="wild"&&!colors.includes(m.color))return send(p,{type:"error",message:"Choose a color"});p.hand.splice(i,1);r.discard.push(c);r.currentColor=c.c==="wild"?m.color:c.c;if(!p.hand.length)return end(r,p);if(c.v==="skip")next(r);else if(c.v==="reverse"){r.direction*=-1;next(r)}else if(c.v==="draw2"){r.pendingDraw=2;next(r)}else if(c.v==="draw4"){r.pendingDraw=4;next(r)}else next(r);broadcast(r)}
 else if(m.type==="draw"&&r.started&&r.players[r.current].id===p.id){let k=r.pendingDraw||1;for(let i=0;i<k;i++)p.hand.push(draw(r));r.pendingDraw=0;next(r);broadcast(r)}
 else if(m.type==="rematch"&&r.winner&&p.id===r.host)start(r);
 else if(m.type==="newhost"&&p.id===r.host){let q=r.players.find(x=>x.id===m.id);if(q)r.host=q.id;broadcast(r)}
 });
 ws.on("close",()=>{if(!p||!r)return;p.ws=null;if(!r.started&&!r.winner){r.players=r.players.filter(x=>x.id!==p.id);if(r.host===p.id)r.host=r.players[0]?.id||null;if(!r.players.length)rooms.delete(r.code)}broadcast(r)})});
const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`UNO Homies server listening on ${PORT}`));
