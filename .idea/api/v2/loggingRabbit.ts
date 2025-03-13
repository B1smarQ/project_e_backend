const amqp = require('amqplib/callback_api');
import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('../v1/logs.db',(err) =>{
    if(err){
        console.log(err);
    }
});

interface LogEntry {
    service: string;
    level: string;
    message: string;
    metadata?: Record<string, any>;
}

amqp.connect('amqps://erhfizhg:sCrrs3sPDKxBKQrUC54Z2nV5jlZtolqZ@hawk.rmq.cloudamqp.com/erhfizhg', function(err, connection) {
    if(err){
        console.log(err);
    }
    connection.createChannel(function(err1, chan) {
        if(err1){
            console.log(err);
        }
        var queue = 'logs'
        chan.assertQueue(queue,{
            durable:false
        });
        chan.consume(queue,(msg)=>{
            let parsedMessage : LogEntry = JSON.parse(msg.content);
            const sql = 'INSERT INTO logs (service, level, message, metadata) VALUES (?, ?, ?, ?)';
            let metadata = parsedMessage.metadata
            const metadataString = metadata ? JSON.stringify(metadata) : null;
            console.log(parsedMessage)
            db.run(sql,[parsedMessage.service, parsedMessage.level, parsedMessage.message, metadataString], (err) =>{
                if(err){
                    console.log(err);
                }
            });
        },{noAck:true})
    })

});