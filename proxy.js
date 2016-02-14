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

function serverConnectListener() {
	console.log("proxy has connected to server");
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

// 2 maps so we can efficiently lookup the corresponding
// socket in either direction
var clients = [];
var servers = []

// establishes connection with the browser
net.createServer(function(clientSocket) {

	clientSocket.name = clientSocket.remoteAddress + ":" + clientSocket.remotePort;
	console.log('remote address ' + clientSocket.remoteAddress);
	console.log('port ' + clientSocket.remotePort);

	clientSocket.on('data', function(data) {
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


		if (clientSocket in clients) {
			// we've seen data from this clientSocket before, so we have a mapping
			// to its corresponding server clientSocket.

		} else {
			// if this is the first time receiving data from this client,
			// establish a connection to the server it wants to communicate
			// with and store the clientSocket mappings

			// create a clientSocket to talk to the server
			var serverSocket = new net.Socket();

			// connect to host:port defined in HTTP request
			var dstHost = getRequestHostname(message);
			var dstPort = getRequestPort(message);
			var srcHost = "localhost";
			var srcPort = 0;  			// bind to any port
			serverSocket.connect({port: dstPort, host: dstHost, localAddress: srcHost, localPort: srcPort}, serverConnectListener);

		}

		//console.log(decoder.write(data));
	});

	// debug for when client disconnects
	clientSocket.on('end', function() {
		clients.splice(clients.indexOf(clientSocket), 1);
		console.log(clientSocket.name + " left the chat.\n")
	});



}).listen(SERVER_PORT);

console.log('proxy up on port ' + SERVER_PORT + '\n');
