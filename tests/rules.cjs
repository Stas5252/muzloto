const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const comm=fs.readFileSync('public/comm.js','utf8');
const getWin=vm.runInNewContext('('+comm.slice(comm.indexOf('  function getWinInfo('),comm.indexOf('  function shuffle(')).trim()+')');
let cases=0;
for(const size of [3,4]){
 const count=size*size,card=Array.from({length:count},(_,i)=>String(i));
 const lineMasks=[];for(let i=0;i<size;i++){let row=0,col=0;for(let j=0;j<size;j++){row|=1<<(i*size+j);col|=1<<(j*size+i)}lineMasks.push(row,col)}
 let diagonal=0,anti=0;for(let i=0;i<size;i++){diagonal|=1<<(i*size+i);anti|=1<<(i*size+size-1-i)}lineMasks.push(diagonal,anti);
 for(let mask=0;mask<(1<<count);mask++){
  const marks=new Set(card.filter((_,i)=>mask&(1<<i)));
  const lines=lineMasks.filter(line=>(mask&line)===line).length;
  for(const mode of ['line','two_lines','full']){
   const expected=mode==='full'?mask===(1<<count)-1:lines>=(mode==='two_lines'?2:1);
   const actual=getWin({size,mode,called:card},{card,marks});assert.equal(actual.win,expected,size+' '+mode+' '+mask);cases++;
  }
 }
}
console.log('PASS exhaustive winning rules: '+cases+' combinations across both grid sizes and all three victory modes.');
