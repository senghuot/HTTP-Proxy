var net		= require('net');
//var ip 		= require('ip');
var message = require('./message');

// used to read buffer and convert to string
var StringDecoder = require("string_decoder").StringDecoder;
var decoder = new StringDecoder('utf8');

const PROTOCOL = {
	UNKNOWN: -1,
    HTTP1_0: 0,
    HTTP1_1: 1,
}

// helper functions

function kthLineOfHeader(header, k) {
	return header.split("\r\n")[k];
}

// HTTP 1.1 specifies that a 'Host' tag is required in all HTTP requests,
// but we should also be 'Host' insensitive?
// Examines an HTTP 1.1 request header and returns the hostname the message is en route to
function getRequestHostname(header) {
	tags = header.split("\r\n");
	for (var i = 0; i < tags.length; i++) {
		if (tags[i].startsWith("Host:")) {
			// we've found a 'Host' tag! extract and return the hostname
			return tags[i].split(" ")[1].split(":")[0];
		}
	}

	// TODO: implement 'Host' tag insensitivity
}

// Examines an HTTP 1.1 request header and returns the port we should use to
// establish a connection with the server this message is trying to reach.
function getRequestPort(header) {
	// TODO: search for port in 'Host' tag and URI before conforming to default

	if (isHTTPS(kthLineOfHeader(header, 0))) {
		return 443;
	} else {
		return 80;
	}
}

function isHTTPS(header) {
	uri = kthLineOfHeader(header, 0).split(" ")[1];
	return uri.toLowerCase().startsWith("https://");
}

// returns the type of protocol for this HTTP message (HTTP1_0, HTTP1_1, HTTPS)
function getRequestProtocolType(header) {
	versionStr = kthLineOfHeader(header, 0).split(" ")[2];

	return versionStr;

	// TODO: is it worth it to have enum values of protocols? or would it
	// make more sense to handle standardized strings?
	switch(versionStr) {
		case "HTTP/1.0":
			return PROTOCOL.HTTP1_0.value;

		case "HTTP/1.1":
			return PROTOCOL.HTTP1_1.value;

		default:
			return PROTOCOL.UNKNOWN.value;
	}
}


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
		var message = decoder.write(data);
		console.log(message);
		// check to make sure we get valid data
		// if (message.lengh >= 2 && message[1].substring(0, 6).toLowercase() == 'host:') {
		//
		// }

		console.log("message hostname: " + getRequestHostname(message));
		console.log("message port: " + getRequestPort(message));
		console.log("message is HTTPS: " + isHTTPS(message));
		console.log("message protocol type: " + getRequestProtocolType(message));

		//console.log(decoder.write(data));
	});

	// debug for when client disconnects
	socket.on('end', function() {
		clients.splice(clients.indexOf(socket), 1);
		console.log(socket.name + " left the chat.\n")
	});



}).listen(SERVER_PORT);

console.log('proxy up on port ' + SERVER_PORT + '\n');
