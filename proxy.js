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
// returns an object: {hostname: "hostname", port: port}
function getRequestHostname(header) {
	// QUESTION: is the end always guarenteed to be \r\n?
	tags = header.split("\r\n");
	for (var i = 0; i < tags.length; i++) {
		// TODO: implement 'Host' tag insensitivity and white space
		// TODO: done, CR me, Scottie!

		// eliminates case sensetivity and white spaces
		var body = tags[i].toLowerCase().split(" ").join("");
		if (body.substring(0, 5) == 'host:') {
			// we've found a 'Host' tag! extract and return the hostname

			// ignores host and grabs hostname:ip
			body = body.substring(5).split(":");
			var host = {};

			// TODO use ip module to transform
			host.hostname = body[0]

			// checks if ports were included
			if (body.length == 2) {
				host.port = parseInt(body[1]);
			}
			return host;
		}
	}
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
	console.log("uri type: " + typeof(uri));
	console.log('uri: ' + uri.toLowerCase());
	// WARNING:might have to be aware when we have ftp
	// and other connections that's not http or https
	return (uri.toLowerCase().indexOf('https://') === 0);
}

// returns the type of protocol for this HTTP message (HTTP1_0, HTTP1_1, HTTPS)
function getRequestProtocolType(header) {
	var versionStr = kthLineOfHeader(header, 0).split(" ")[2];

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

function transformHeader(header) {
	var headerLines = header.split("\r\n");
	headerLines[0] = setHTTPVersion(headerLines[0], "1.0");
	headerLines = setConnectionTagClosed(headerLines);
	return headerLines.join("\r\n").concat("\r\n");
}

function setHTTPVersion(firstLineOfHeader, versionNum) {
	firstLineSplit = firstLineOfHeader.split(" ");
	firstLineSplit[2] = "HTTP/" + versionNum;
	return firstLineSplit.join(" ");
}

// Takes an array of Strings, representing the lines representing the
// lines of an HTTP header, and returns an array of Strings with all 'Connection'
// and 'Proxy-connection' tags set to 'close'
function setConnectionTagClosed(headerLines) {
	for (var i = 0; i < headerLines.length; i++) {
		if (headerLines[i].startsWith("Connection:")) {
			headerLines[i] = "Connection: close";
		} else if (headerLines[i].startsWith("Proxy-connection:")) {
			headerLines[i] = "Proxy-connection: close";
		}
	}
	return headerLines;
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
var servers = [];

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
		var test = getRequestHostname(message);
		console.log("message hostname: " + test.hostname);
		console.log("messate port from host object: " + test.port);
		console.log("message port: " + getRequestPort(message));
		console.log("message is HTTPS: " + isHTTPS(message));
		console.log("message protocol type: " + getRequestProtocolType(message));

		console.log("transformed header:");
		console.log(transformHeader(message));


		if (clientSocket in clients) {
			// we've seen data from this clientSocket before, so we have a mapping
			// to its corresponding server clientSocket.

		} else {
			// if this is the first time receiving data from this client,
			// establish a connection to the server it wants to communicate
			// with and store the clientSocket mappings

			// create a clientSocket to talk to the server, store mappings
			var serverSocket = new net.Socket();
			clients[clientSocket] = serverSocket;
			servers[serverSocket] = clientSocket;

			// if connection fails, send back an HTTP 502 Bad Gateway response to the client
			// TODO: browser doesn't show indication of receiving response
			serverSocket.on('error', function(errorObj) {
				console.log("failed to connect to server");
				console.log("error: " + errorObj);
				response = "HTTP/1.0 502 Bad Gateway\r\n\r\n";
				clientSocket.write(response);
				clientSocket.end();
				serverSocket.end();
			});

			// if we are able to establish a connection with a server,
			// send back a HTTP 200 OK response to the client
			// TODO: browser vreceives no indication of receiving response
			serverSocket.on('connect', function() {
				console.log("proxy has connected to server");
				response = "HTTP/1.0 200 OK\r\n\r\n";
				clientSocket = servers[serverSocket];
				clientSocket.write(response);

			});

			// connect to host:port defined in HTTP request
			var host = getRequestHostname(message);
			var dstHost = host.hostname;
			// combine the port code inside the getRequestHostName function
			var dstPort = getRequestPort(message);

			if (host.port) {
				dstPort = host.port;
			}
			var srcHost = "127.0.0.1";
			var srcPort = 0;  			// bind to any port

			console.log("dst port: " + dstPort);
			console.log("dst host: " + dstHost);
			console.log("src port: " + srcPort);
			console.log("src host: " + srcHost);

			// if you use google's ip: 8.8.8.8 you get unreachable destination
			serverSocket.connect({port: dstPort, host: dstHost, localAddress: srcHost, localPort: srcPort}, serverConnectListener);
			
			// comment out and then default option is to throw
			// an exception
			serverSocket.on("error", function(error) {
				console.log("connectivity problem: " + error);
			})

		}

		//console.log(decoder.write(data));
	});

	// debug for when client disconnects
	// Emitted when the other end of the socket sends a FIN packet.
	clientSocket.on('end', function() {
		clients.splice(clients.indexOf(clientSocket), 1);
		console.log(clientSocket.name + " sent a FIN packet.\n");
	});

	// Emitted once the socket is fully closed
	clientSocket.on('close', function(had_error) {
		clients.splice(clients.indexOf(clientSocket), 1);
		console.log(clientSocket.name + " fully closed its connection w/ proxy");
	});



}).listen(SERVER_PORT);

console.log('proxy up on port ' + SERVER_PORT + '\n');
