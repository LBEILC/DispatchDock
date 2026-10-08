// 只供隔离演示，收到父进程消息后自行退出。
setInterval(()=>{},1000);
process.on('message',message=>{if(message==='exit')process.exit(0);});
process.on('disconnect',()=>process.exit(0));
if(process.send)process.send({ready:true});
