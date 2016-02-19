var net     = require('net');
var message = require('./message');

// used to read buffer and convert to string
var StringDecoder = require("string_decoder").StringDecoder;
var decoder = new StringDecoder('utf8');

var tunnelConnections = {};

const PROTOCOL = {
    UNKNOWN: -1,
    HTTP1_0: 0,
    HTTP1_1: 1,
}

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "TRACE", "CONNECT"];

const HTTP_DEFAULT_PORT = 80;
const HTTPS_DEFAULT_PORT = 443;
const DEBUG = false;

function d_print(message) {
    if (DEBUG) {
        console.log(message);
    }
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

    return (uri.toLowerCase().indexOf('https://') === 0) || (uri.split(":")[1] === "443");
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
        } else if (headerLines[i].startsWith("Proxy-connection:")
                || headerLines[i].startsWith("Proxy-Connection:")) {
            headerLines[i] = "Proxy-Connection: close";
        }
    }
    return headerLines;
}

const PROXY_PORT = parseInt(process.argv[2]);
const PROXY_HOST = "0.0.0.0";

// reading input form stdin
if (process.argv.length != 3) {
    console.log("Usage: port");
    process.exit();
}

if (isNaN(PROXY_PORT)) {
    console.log("Usage: port must be numbers only")
    process.exit();
}

// 2 maps so we can efficiently lookup the corresponding
// socket in either direction
/*var tunnelClients = [];
var tunnelClientReconnectData = [];
var tunnelServers = [];*/

// establishes connection with the browser
//TODO: it appears that we're seeing the
// same TCP socket for every connection from the browser
// If we want to distinguish between different tabs, or closing and opening tabs,
// we need a way to differentiate our client facing sockets
net.createServer(function(clientSocket) {
    clientSocket.name = clientSocket.remoteAddress + ":" + clientSocket.remotePort;
    d_print("name of socket " + clientSocket.name);
    clientSocket.on('data', function(data) {
        d_print("RECEIVING DATA");
        if (clientSocket.name in tunnelConnections) {
            d_print("DATA FROM TUNNEL CLIENT");
            d_print(data);
            tunnelConnections[clientSocket.name].write(data);
        } else {
            d_print("DATA FROM ");
            var message = decoder.write(data);
            //message = transformHTTPHeader(message);
            console.log("before");
            console.log(message);
            message = message.replace("Proxy-Connection: keep-alive", "Proxy-Connection: close");
            message = message.replace("Connection: keep-alive", "Connection: close");
        	message = message.replace("HTTP/1.1", "HTTP/1.0");
            console.log("after");
            console.log(message);

            // spec output
            firstLineOfHeader = kthLineOfHeader(message, 0).split(" ");
            printTime(">>> " + firstLineOfHeader[0] + " " + firstLineOfHeader[1]);

            var HTTP_method = getRequestMethod(message);
            if (HTTP_METHODS.indexOf(HTTP_method) < 0) {
            	// method name doesn't match any in the protocol, so something is wrong.
            	// close the client, he'll have to try again later
            	d_print("method was corrupted, so we're not connecting to server");
            	clientSocket.end();
            	return;
            }

            // get info for server connection
            var host = getRequestHostname(message);
		    if (host == undefined) {
		        d_print("host is undefined, here's the message it came from");
		        d_print(message);
		        // host is undefined, so something is wrong. 
		        // close the client, he'll have to try again later
		        d_print("Client hostname was corrupted, so we're not connecting to server");
		        clientSocket.end();
		        return;
		    }
		    var dstHost = host.hostname;
		    var dstPort = host.port;

		    var srcHost = PROXY_HOST;
		    var srcPort = 0; // bind to any port

		    connectObj = {port: dstPort, host: dstHost, localAddress: srcHost, localPort: srcPort};

            if (HTTP_method == "CONNECT") {
                d_print("clientSocket received an HTTP CONNECT");
                // attempt to create server facing TCP connection
                initTunnelServerSocket(connectObj, data, clientSocket);
                return;
            } else if (HTTP_method == "GET") {
                d_print("clientSocket received an HTTP GET");
            }
            // if this is the first time receiving data from this client,
            // establish a connection to the server it wants to communicate
            // with and store the clientSocket mappings
            //clientSocket.write(new Buffer("data", 'utf-8'));
            initNormalServerSocket(connectObj, message, data, clientSocket);
        //}
        }


    });

    d_print('remote port ' + clientSocket.remotePort);

    // debug for when client disconnects
    // Emitted when the other end of the socket sends a FIN packet.
    clientSocket.on('end', function() {
        d_print(clientSocket.name + " sent a FIN packet.");
    });

    // Emitted once the socket is fully closed
    clientSocket.on('close', function(had_error) {
        // clients.splice(clients.indexOf(clientSocket), 1);
        d_print(clientSocket.name + " fully closed its connection w/ proxy");
        if (clientSocket.name in tunnelConnections) {
            tunnelConnections[clientSocket.name].end();
            delete tunnelConnections[clientSocket.name]
        }
        /*if (tunnelClients[clientSocket] in tunnelServers) {
            delete tunnelServers[tunnelClients[clientSocket]];
            tunnelClients[clientSocket].end();
        }
        if (clientSocket in tunnelClients) {
            delete tunnelClients[clientSocket];
        }*/
    });

    clientSocket.on('error', function(errorObj) {
        d_print("clientSocket encountered an error: " + errorObj);
    });

}).listen(PROXY_PORT);

function initTunnelServerSocket(connectObj, data, clientSocket) {    
    var serverSocket = new net.Socket();

    d_print("starting tunnel to: " + connectObj.dstHost + ":" + connectObj.dstPort);

    serverSocket.setTimeout(3 * 1000, function() {
        console.log("timeout call back")
        clientSocket.write(new Buffer('HTTP/1.0 502 Bad Gateway \r\n\r\n'));
        clientSocket.end();
        serverSocket.end();
    });

    serverSocket.on("data", function(data) {
        if (DEBUG) {
            d_print("TUNNEL SERVER FROM DATA");
            d_print(data);
        }
        clientSocket.write(data);
    });

    serverSocket.on("error", function(error) {
        d_print("TUNNEL SERVER ERROR");
        d_print(error);
    });

    // Have to end the server manually if we
    // override
    serverSocket.on("end", function() {
        d_print("SOCKETED END");
    });

    serverSocket.on("close", function(has_error) {
        d_print("SOCKET CLOSE")
        if (has_error) {
            d_print("HAS ERROR");
            clientSocket.write(new Buffer('HTTP/1.0 502 Bad Gateway \r\n\r\n'));
        } else {
            d_print("NO PROBLEM");
        }
        clientSocket.end();
        d_print("SOCKETED END");
    });

    // can the ip be the problem?
    serverSocket.connect(connectObj, function() {
        d_print("connected to the server");
        d_print(clientSocket.name);  
        serverSocket.setTimeout(0);
        var buf = new Buffer("HTTP/1.0 200 OK \r\n\r\n");
        clientSocket.write(buf);
        tunnelConnections[clientSocket.name] = serverSocket;
    });

    return serverSocket;
}

function initNormalServerSocket(connectObj, message, data, clientSocket) {
    // create a clientSocket to talk to the server, store mappings
    d_print("init normal server socket");
    var serverSocket = new net.Socket();
    serverSocket.setTimeout(3000);

    serverSocket.on('error', function (errorObj) {
        d_print("failed to connect to server");
        d_print(errorObj);
    });

    serverSocket.on('timeout', function () {
        d_print("failed to connect to server: Timeout");
    })

    serverSocket.on('connect', function () {
        d_print("proxy has connected to server");
        // upon connection, send our data to the server
        serverSocket.setTimeout(0); // disables
        serverSocket.write(new Buffer(message));
        //serverSocket.write(data);
    });

    // if we receive any information back from the server,
    // shovel back any bytes to our client
    serverSocket.on('data', function (serverData) {
        //var buf = new Buffer(transformHTTPHeader("" + data));
        clientSocket.write(serverData);
    })


    // if you use google's ip: 8.8.8.8 you get unreachable destination
    serverSocket.connect(connectObj);
}


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

printTime('Proxy listening on ' + PROXY_HOST + ':' + PROXY_PORT);
