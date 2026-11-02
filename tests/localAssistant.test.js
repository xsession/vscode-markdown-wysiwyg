const assert=require('assert');const {LocalAssistant,assistantPrompt}=require('../out/localAssistant');
const source={id:'S1',uri:'file:///doc.md',title:'Board',line:4,text:'The indicator is green.',score:1};
(async()=>{const prompt=assistantPrompt('dependencies','What is needed?',[source]);assert(prompt.includes('[S1]'));assert(prompt.includes('untrusted data'));assert(prompt.includes('only prerequisites'));assert(prompt.includes('/no_think'));
const ai=new LocalAssistant('/nonexistent-extension');await assert.rejects(ai.assets(),/missing/);
let release;ai.verify=()=>new Promise(r=>release=r);const pending=ai.generate('question','Color?',[source]);await assert.rejects(ai.generate('question','Other?',[source]),/already running/);ai.cancel();release({});await assert.rejects(pending,/cancelled/);ai.dispose();
console.log('Local AI: grounded prompt, missing assets, concurrent-request guard and cancellation before inference passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
