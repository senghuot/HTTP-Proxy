var net		= require('net');
var message = require('./message');

// used to read buffer and convert to string
var StringDecoder = require("string_decoder").StringDecoder;
var decoder = new StringDecoder('utf8');

const PROTOCOL = {
    UNKNOWN: -1,
    HTTP1_0: 0,
    HTTP1_1: 1,
}

const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;

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
    const tags = header.split("\r\n");
    for (var i = 0; i < tags.length; i++) {
        // eliminates case sensitivity and white spaces
        var body = tags[i].toLowerCase().split(" ").join("");

        // look for 'Host' and return the hostname
        if (body.substring(0, 5) == 'host:') {
            // ignores host and grabs hostname:ip
            body = body.substring(5).split(":");
            var host = {};

            host.hostname = body[0]

            // checks if ports were included
            if (body.length == 2) {
                host.port = parseInt(body[1]);
            } else {
                host.port = getRequestPort(header);
            }

            return host;
        }
    }
}

// Examines an HTTP 1.1 request header and returns the port we should use to
// establish a connection with the server this message is trying to reach.
function getRequestPort(header) {
    if (isHTTPS(kthLineOfHeader(header, 0))) {
        return HTTPS_DEFAULT_PORT;
    } else {
        return HTTP_DEFAULT_PORT;
    }
}

function getRequestMethod(header) {
    return kthLineOfHeader(header, 0).split(" ")[0];
}


function isHTTPS(header) {
    uri = kthLineOfHeader(header, 0).split(" ")[1];
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

// takes an HTTP header and transforms it into our 'proxy friendly'
// version so we don't have to deal with framing issues :)
function transformHTTPHeader(header) {
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

// function serverConnectionFailure(clientSocket, serverSocket) {
// 	console.log("failed to connect to server");
// 	response = "HTTP/1.0 502 Bad Gateway\r\n\r\n";
// 	clientSocket.write(response);
// 	serverSocket.end();
// }

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
var tunnelClients = [];
var tunnelClientReconnectData = [];
var tunnelServers = [];

// establishes connection with the browser
//TODO: it appears that we're seeing the
// same TCP socket for every connection from the browser
// If we want to distinguish between different tabs, or closing and opening tabs,
// we need a way to differentiate our client facing sockets
net.createServer(function(clientSocket) {

    clientSocket.name = clientSocket.remoteAddress + ":" + clientSocket.remotePort;
    clientSocket.on('data', function(data) {
    	if (clientSocket in tunnelClients) {
    		console.log("tunnel client data:");
    		serverSocket = tunnelClients[clientSocket];
    		serverSocket.write(data);
    	} else {
    		var message = decoder.write(data);
	        var HTTP_method = getRequestMethod(message);
	        console.log("HTTP message data:");
	        console.log(message);

	        if (HTTP_method == "CONNECT") {
	        	console.log("clientSocket received an HTTP CONNECT");
	        	// attempt to create server facing TCP connection
	        	initTunnelServerSocket(message, data, clientSocket, false);
	        	return;
	        } else if (HTTP_method == "GET") {
	        	console.log("clientSocket received an HTTP GET");
	        }

	        // if this is the first time receiving data from this client,
	        // establish a connection to the server it wants to communicate
	        // with and store the clientSocket mappings
	        initNormalServerSocket(message, data, clientSocket);
    	}

        
    });

    console.log('remote port ' + clientSocket.remotePort);

	// debug for when client disconnects
	// Emitted when the other end of the socket sends a FIN packet.
	clientSocket.on('end', function() {
		console.log(clientSocket.name + " sent a FIN packet.");
	});

	// Emitted once the socket is fully closed
	clientSocket.on('close', function(had_error) {
		// clients.splice(clients.indexOf(clientSocket), 1);
		console.log(clientSocket.name + " fully closed its connection w/ proxy");

		if (tunnelClients[clientSocket] in tunnelServers) {
			delete tunnelServers[tunnelClients[clientSocket]];
			tunnelClients[clientSocket].end();
		}
		if (clientSocket in tunnelClients) {
			delete tunnelClients[clientSocket];
		}
	});

	clientSocket.on('error', function(errorObj) {
		console.log("clientSocket encountered an error: " + errorObj);
	});

}).listen(SERVER_PORT);

// helper function to print message with time
var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function printTime(message) {
    var now = new Date();
    var timeOutput = now.getDate() + " " + monthNames[now.getMonth()] + " ";
    timeOutput += now.toLocaleTimeString() + " - ";
    console.log(timeOutput + message);
}

function initNormalServerSocket(message, data, clientSocket) {
	// create a clientSocket to talk to the server, store mappings
	console.log("init normal server socket");
    var serverSocket = new net.Socket();
    serverSocket.setTimeout(3000);

    serverSocket.on('error', function (errorObj) {
        console.log("failed to connect to server");
        console.log(errorObj);
    });

    serverSocket.on('timeout', function () {
        console.log("failed to connect to server: Timeout");
    })

    serverSocket.on('connect', function () {
        console.log("proxy has connected to server");
        // upon connection, send our data to the server
        serverSocket.setTimeout(0); // disables
        serverSocket.write(data);
    });

    // if we receive any information back from the server,
    // shovel back any bytes to our client
    serverSocket.on('data', function (serverData) {
        // TODO: broswer can't tell the different between header and content in serverData.
        // the reason why simple.txt and simple.html doesn't load because we never close
        // the connection properly.
        console.log("server data:");
		// console.log(decoder.write(serverData));
        // this work except we have could potentially close to early if we need to download
        // additional files such as css, img...etcgj
        //servers[serverSocket].end(serverData);
        clientSocket.write(serverData);
		// servers[serverSocket].end();
    })

    // connect to host:port defined in HTTP request
    var host = getRequestHostname(message);
    if (host == undefined) {
    	console.log("host is undefined, here's the message it came from");
    	console.log(message);
    }
    var dstHost = host.hostname;
    var dstPort = host.port;

    var srcHost = "0.0.0.0";
    var srcPort = 0; // bind to any port

    // if you use google's ip: 8.8.8.8 you get unreachable destination
    serverSocket.connect({port: dstPort, host: dstHost, localAddress: srcHost, localPort: srcPort});
}

function initTunnelServerSocket(message, data, clientSocket, reconnect) {
	console.log("init tunnel server socket");
	// create a clientSocket to talk to the server, store mappings
    var serverSocket = new net.Socket();
    // clients[clientSocket] = serverSocket;
    // servers[serverSocket] = clientSocket;
    serverSocket.setTimeout(3000);

    tunnelClients[clientSocket] = serverSocket;
    tunnelServers[serverSocket] = clientSocket;

    // if connection fails, send back an HTTP 502 Bad Gateway response to the client
    // TODO: browser doesn't show indication of receiving response
    serverSocket.on('error', function (errorObj) {
        console.log("failed to connect to tunnel server");
        console.log(errorObj);

        delete tunnelClients[clientSocket];
        delete tunnelServers[serverSocket];
        serverSocket.end();

        if (!reconnect) {
        	response = "HTTP/1.0 502 Bad Gateway\r\n\r\n";
        	clientSocket.write(response);
        } else {
        	serverSocket = initTunnelServerSocket(message, data, clientSocket, true);
        }
    });

    serverSocket.on('timeout', function () {
        console.log("failed to connect to tunnel server: Timeout");

        delete tunnelClients[clientSocket];
        delete tunnelServers[serverSocket];
        serverSocket.end();

        if (!reconnect) {
        	response = "HTTP/1.0 502 Bad Gateway\r\n\r\n";
        	clientSocket.write(response);
        } else {
        	serverSocket = initTunnelServerSocket(message, data, clientSocket, true);
        }
        
        
        
    });

    // if we are able to establish a connection with a server,
    // send back a HTTP 200 OK response to the client
    // TODO: browser vreceives no indication of receiving response
    serverSocket.on('connect', function () {
        console.log("proxy has connected to server for tunneling");

		// we're not supposed to send this upon connecting to the server,
		// just on an HTTP CONNECT method
		if (!reconnect) {
			response = "HTTP/1.0 200 OK\r\n\r\n";
        	clientSocket.write(response);
		}
        
        // upon connection, send our data to the server
        serverSocket.setTimeout(0); // disables
        // serverSocket.write(data);
    });

    // if our tunnel server closes and our client connection is still open
    // just open another one in case client wants to keep sending things
    serverSocket.on('close', function() {
    	if (serverSocket in tunnelServers) {
    		delete tunnelServers[serverSocket];
    		delete tunnelClients[clientSocket];
    		initTunnelServerSocket(message, data, clientSocket, true);
    	}
    });

    // if we receive any information back from the server,
    // shovel back any bytes to our client
    serverSocket.on('data', function (serverData) {
        // TODO: broswer can't tell the different between header and content in serverData.
        // the reason why simple.txt and simple.html doesn't load because we never close
        // the connection properly.
        console.log("tunnel server data:");
		// console.log(decoder.write(serverData));
        // this work except we have could potentially close to early if we need to download
        // additional files such as css, img...etcgj
        //servers[serverSocket].end(serverData);
        clientSocket.write(serverData);
		// servers[serverSocket].end();
    })

    connectObj = {};
    if (!reconnect) {
    	// connect to host:port defined in HTTP request
	    var host = getRequestHostname(message);
	    console.log(host);
	    var dstHost = host.hostname;
	    var dstPort = host.port;

	    var srcHost = "0.0.0.0";
	    var srcPort = 0; // bind to any port
	    connectObj = {port: dstPort, host: dstHost, localAddress: srcHost, localPort: srcPort};
	    tunnelClientReconnectData[clientSocket] = connectObj;
    } else {
    	connectObj = tunnelClientReconnectData[clientSocket];
    }
    

    // if you use google's ip: 8.8.8.8 you get unreachable destination
    serverSocket.connect(connectObj);
    return serverSocket;
}

printTime('Proxy listening on ' + SERVER_PORT);
