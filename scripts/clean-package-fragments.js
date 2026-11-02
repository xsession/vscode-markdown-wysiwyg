const fs=require('fs'),path=require('path');let removed=0;
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&entry.name.includes('.partial')){fs.unlinkSync(file);removed++;}}}
walk(path.resolve(__dirname,'../resources'));console.log('Package preparation removed '+removed+' incomplete download fragments.');
