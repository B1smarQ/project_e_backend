// @ts-ignore
const amqp = require('amqplib/callback_api');

amqp.connect('amqps://erhfizhg:sCrrs3sPDKxBKQrUC54Z2nV5jlZtolqZ@hawk.rmq.cloudamqp.com/erhfizhg', (err, conn) => {
    if (err) {
        console.log(err);
    }
    conn.createChannel((err1, chan)=>{
        if(err1){
            console.log(err);
        }
        let queue = 'logs'
        let message = {service: 'testing',level: 'info', message: 'test message', metadata:null};
        chan.assertQueue(queue,{
            durable:false
        })

        setTimeout(()=>{
            chan.sendToQueue(queue, Buffer.from(JSON.stringify(message)))
            console.log('message sent')
        },500)
    })
});