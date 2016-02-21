var exports = module.exports = {};

var COMMON_HEADER = new Buffer([0xC4, 0x61]);
const MESSAGE = {
    NONE: 0,
    REGISTER: 1,
    REGISTERED: 2,
    FETCH: 3,
    FETCH_RESPONSE: 4,
    UNREGISTER: 5,
    PROBE: 6,
    ACK: 7
}

exports.MESSAGE = MESSAGE;

exports.getMessageType = function(index) {
    for (var key in MESSAGE) {
        if (MESSAGE[key] == index)
            return key;
    }
}

// creates a "Register" packet buffer from given arguments
// NOTE: appropriate response from server is sent with correct values sent to this function
exports.getRegisterBuf = function(seq_num, ip_bytes, port_num, data, service) {
    var seq             = intToBytes(seq_num, 1);
    var messageType     = intToBytes(MESSAGE.REGISTER, 1);
    var ip              = new Buffer(ip_bytes);
    var port            = intToBytes(port_num, 2);
    var data_buf        = intToBytes(data, 4);
    var len             = intToBytes(service.length, 1);
    var name            = new Buffer(service);

    return Buffer.concat([COMMON_HEADER, seq, messageType, ip, port, data_buf, len, name]);
}

// creates an object of the "Registered" packet with easy to use fields
// (ex. seq_num, lifetime)
exports.getRegisteredObj = function(buffer) {
    var packet = {};
    packet.messageType = exports.messageType(buffer);
    packet.seq_num = buffer.readInt8(2);       // offset of seqnum in all packets
    packet.lifetime = buffer.readUInt16BE(4);  // offset of lifetime in the "Registered packet"
    return packet;
}

// creates a "Fetch" packet buffer from given arguments
exports.getFetchBuf = function(seq_num, service) {
    var seq             = intToBytes(seq_num, 1);
    var messageType     = intToBytes(MESSAGE.FETCH, 1);
    var serviceNameLength = intToBytes(service.length, 1);
    var service = new Buffer(service);
    return Buffer.concat([COMMON_HEADER, seq, messageType, serviceNameLength, service]);
}

// creats an object of the "FetchResponse" packet with easy to use fields
// contains a list of entry objects that have serviceIP, servicePort, and serviceData fields
exports.getFetchResponseObj = function(buffer) {
    var packet = {};
    packet.messageType = exports.messageType(buffer);
    packet.seq_num = buffer.readInt8(2);       // offset of seqnum in all packets
    packet.entries = [];
    var num_entries = buffer.readInt8(4);
    for (var i = 5; i < 10 * num_entries; i += 10) {
        var entry = {};

        entry.serviceIP = buffer.readUInt8(i);
        entry.serviceIP += '.' + buffer.readUInt8(i + 1);
        entry.serviceIP += '.' + buffer.readUInt8(i + 2);
        entry.serviceIP += '.' + buffer.readUInt8(i + 3);
        
        entry.servicePort = buffer.readUInt16BE(i+4);
        entry.serviceData = buffer.readUInt32BE(i+6);
        packet.entries.push(entry);
    }
    return packet;
}

// creates an "Unregister" packet buffer from given arguments
exports.getUnregisterBuf = function(seq_num, service, port) {
    var seq             = intToBytes(seq_num, 1);
    var messageType     = intToBytes(MESSAGE.UNREGISTER, 1);

    // TODO might have to translate from localhost -> 127.0.0.1
    var ip              = new Buffer(service);
    var port            = intToBytes(port, 2);
    return Buffer.concat([COMMON_HEADER, seq, messageType, ip, port]);
}


// creates a "Probe" packet buffer from the given arguments
exports.getProbeBuf = function(seq_num) {
    var seq             = intToBytes(seq_num, 1);
    var messageType     = intToBytes(MESSAGE.PROBE, 1);
    return Buffer.concat([COMMON_HEADER, seq, messageType]);
}

exports.getProbeObj = function(buffer) {
    var packet = {};
    packet.messageType = exports.messageType(buffer);
    packet.seq_num = buffer.readInt8(2);       // offset of seqnum in all packets
    return packet;
}

// creates an "ACK" packet buffer from the given arguments
exports.getAckBuf = function(seq_num) {
    var seq             = intToBytes(seq_num, 1);
    var messageType     = intToBytes(MESSAGE.ACK, 1);
    return Buffer.concat([COMMON_HEADER, seq, messageType]);
}

exports.getAckObj = function(buffer) {
    var packet = {};
    packet.messageType = exports.messageType(buffer);
    packet.seq_num = buffer.readInt8(2);       // offset of seqnum in all packets
    return packet;
}

// returns the type of message defined in MESSAGE above from a given buffer
// assumes packet is well formed
exports.messageType = function(buffer) {

    var type_num = buffer.readInt8(3); // offset of message type in all packets
    if (type_num > MESSAGE.ACK) {
        return null;
    } else {
        return type_num;
    }
}

function intToBytes(num, len) {
    var buffer = null
    buffer = new Buffer(len);

    switch (len) {
        case 1:
            buffer.writeUInt8(num);
            break;
        case 2:
            buffer.writeUInt16BE(num, 0);
            break;
        case 4:
            buffer.writeUInt32BE(num, 0);
            break;
        default:
            buffer = null;
            break;
    }
    return buffer;
}


function bytesToInt(num, len, offset) {
    buffer = new Buffer(2);
    buffer.writeUInt16BE(32312, 0);
    console.log(buffer);
    // this is how you read specific bytes
    console.log(buffer.readUInt16BE(offset));
}

function convertToBuffer(arrayBuffer) {
    var buffer = new Buffer(arrayBuffer.byteLength);
    for (var i = 0; i < arrayBuffer.byteLength; i++) {
        buffer[i] = arrayBuffer[i];
    }
    return buffer;
}
