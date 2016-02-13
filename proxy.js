var net		= require('net');
//var ip 		= require('ip');
var message = require('./message');

// used to read buffer and convert to string
var StringDecoder = require("string_decoder").StringDecoder;
var decoder = new StringDecoder('utf8');

const SERVER_PORT    = 	parseInt(process.argv[2]);

// reading input form stdin
if (process.argv.length != 3) {
    console.log("Usage: port");
    process.exit();
}

if (isNaN(SERVER_PORT)) {
    console.log("Usage: port must be numbers only")
    process.exit();
}

var clients = [];

// establishes connection with the browser
net.createServer(function(socket) {

	socket.name = socket.remoteAddress + ":" + socket.remotePort;
	console.log('remote address ' + socket.remoteAddress);
	console.log('port ' + socket.remotePort);

	// adds the client to our list
	clients.push(socket);

	socket.on('data', function(data) {
		var message = decoder.write(data).split('\n');
		console.log(message);
		// check to make sure we get valid data
		if (message.lengh >= 2 && message[1].substring(0, 6).toLowercase() == 'host:') {
			
		}

		//console.log(decoder.write(data));
	});

	// debug for when client disconnects
	socket.on('end', function() {
		clients.splice(clients.indexOf(socket), 1);
		console.log(socket.name + " left the chat.\n")
	});



}).listen(SERVER_PORT);

console.log('proxy up on port ' + SERVER_PORT + '\n');