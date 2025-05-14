Streams

The Streams API ↗ is a web standard API that allows JavaScript to programmatically access and process streams of data.

    ReadableStream
    ReadableStream BYOBReader
    ReadableStream DefaultReader
    TransformStream
    WritableStream
    WritableStream DefaultWriter

Workers do not need to prepare an entire response body before returning a Response. You can use a ReadableStream to stream a response body after sending the front matter (that is, HTTP status line and headers). This allows you to minimize:

    The visitor's time-to-first-byte.
    The buffering done in the Worker.

Minimizing buffering is especially important for processing or transforming response bodies larger than the Worker's memory limit. For these cases, streaming is the only implementation strategy.

Note

By default, Cloudflare Workers is capable of streaming responses using the Streams APIs ↗. To maintain the streaming behavior, you should only modify the response body using the methods in the Streams APIs. If your Worker only forwards subrequest responses to the client verbatim without reading their body text, then its body handling is already optimal and you do not have to use these APIs.

The worker can create a Response object using a ReadableStream as the body. Any data provided through the ReadableStream will be streamed to the client as it becomes available.

Module Worker

    Service Worker

export default {
  async fetch(request, env, ctx) {
    // Fetch from origin server.
    const response = await fetch(request);

    // ... and deliver our Response while that’s running.
    return new Response(response.body, response);
  },
};

A TransformStream and the ReadableStream.pipeTo() method can be used to modify the response body as it is being streamed:

Module Worker

    Service Worker

export default {
  async fetch(request, env, ctx) {
    // Fetch from origin server.
    const response = await fetch(request);

    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(modifyChunkSomehow(chunk));
      },
    });

    // Start pumping the body. NOTE: No await!
    response.body.pipeTo(writable);

    // ... and deliver our Response while that’s running.
    return new Response(readable, response);
  },
};

This example calls response.body.pipeTo(writable) but does not await it. This is so it does not block the forward progress of the remainder of the fetchAndStream() function. It continues to run asynchronously until the response is complete or the client disconnects.

The runtime can continue running a function (response.body.pipeTo(writable)) after a response is returned to the client. This example pumps the subrequest response body to the final response body. However, you can use more complicated logic, such as adding a prefix or a suffix to the body or to process it somehow.
Common issues

Warning

The Streams API is only available inside of the Request context, inside the fetch event listener callback.
Related resources

    MDN's Streams API documentation ↗
    Streams API spec ↗
    Write your Worker code in ES modules syntax for an optimized experience.

ReadableStream
Background

A ReadableStream is returned by the readable property inside TransformStream.
Properties

    locked boolean
        A Boolean value that indicates if the readable stream is locked to a reader.

Methods

    pipeTo(destinationWritableStream, optionsPipeToOptions) : Promise<void>
        Pipes the readable stream to a given writable stream destination and returns a promise that is fulfilled when the write operation succeeds or rejects it if the operation fails.

    getReader(optionsObject) : ReadableStreamDefaultReader
        Gets an instance of ReadableStreamDefaultReader and locks the ReadableStream to that reader instance. This method accepts an object argument indicating options. The only supported option is mode, which can be set to byob to create a ReadableStreamBYOBReader, as shown here:

let reader = readable.getReader({ mode: 'byob' });

PipeToOptions

    preventClose bool
        When true, closure of the source ReadableStream will not cause the destination WritableStream to be closed.

    preventAbort bool
        When true, errors in the source ReadableStream will no longer abort the destination WritableStream. pipeTo will return a rejected promise with the error from the source or any error that occurred while aborting the destination.

Related resources

    Streams
    Readable streams in the WHATWG Streams API specification ↗
    MDN’s ReadableStream documentation ↗

ReadableStream BYOBReader
Background

BYOB is an abbreviation of bring your own buffer. A ReadableStreamBYOBReader allows reading into a developer-supplied buffer, thus minimizing copies.

An instance of ReadableStreamBYOBReader is functionally identical to ReadableStreamDefaultReader with the exception of the read method.

A ReadableStreamBYOBReader is not instantiated via its constructor. Rather, it is retrieved from a ReadableStream:

const { readable, writable } = new TransformStream();
const reader = readable.getReader({ mode: 'byob' });

Methods

    read(bufferArrayBufferView) : Promise<ReadableStreamBYOBReadResult>
        Returns a promise with the next available chunk of data read into a passed-in buffer.

    readAtLeast(minBytes, bufferArrayBufferView) : Promise<ReadableStreamBYOBReadResult>
        Returns a promise with the next available chunk of data read into a passed-in buffer. The promise will not resolve until at least minBytes have been read.

Common issues

Warning

read provides no control over the minimum number of bytes that should be read into the buffer. Even if you allocate a 1 MiB buffer, the kernel is perfectly within its rights to fulfill this read with a single byte, whether or not an EOF immediately follows.

In practice, the Workers team has found that read typically fills only 1% of the provided buffer.

readAtLeast is a non-standard extension to the Streams API which allows users to specify that at least minBytes bytes must be read into the buffer before resolving the read.
Related resources

    Streams
    Background about BYOB readers in the Streams API WHATWG specification ↗

ReadableStream DefaultReader
Background

A reader is used when you want to read from a ReadableStream, rather than piping its output to a WritableStream.

A ReadableStreamDefaultReader is not instantiated via its constructor. Rather, it is retrieved from a ReadableStream:

const { readable, writable } = new TransformStream();
const reader = readable.getReader();

Properties

    reader.closed : Promise
        A promise indicating if the reader is closed. The promise is fulfilled when the reader stream closes and is rejected if there is an error in the stream.

Methods

read() : Promise

    A promise that returns the next available chunk of data being passed through the reader queue.

cancel(reasonstringoptional) : void

    Cancels the stream. reason is an optional human-readable string indicating the reason for cancellation. reason will be passed to the underlying source’s cancel algorithm -- if this readable stream is one side of a TransformStream, then its cancel algorithm causes the transform’s writable side to become errored with reason.

    Warning

    Any data not yet read is lost.

    releaseLock() : void
        Releases the lock on the readable stream. A lock cannot be released if the reader has pending read operations. A TypeError is thrown and the reader remains locked.

Related resources

    Streams
    Readable streams in the WHATWG Streams API specification ↗

TransformStream
Background

A transform stream consists of a pair of streams: a writable stream, known as its writable side, and a readable stream, known as its readable side. Writes to the writable side result in new data being made available for reading from the readable side.

Workers currently only implements an identity transform stream, a type of transform stream which forwards all chunks written to its writable side to its readable side, without any changes.
Constructor

let { readable, writable } = new TransformStream();

    TransformStream() TransformStream
        Returns a new identity transform stream.

Properties

    readable ReadableStream
        An instance of a ReadableStream.
    writable WritableStream
        An instance of a WritableStream.

IdentityTransformStream

The current implementation of TransformStream in the Workers platform is not current compliant with the Streams Standard ↗ and we will soon be making changes to the implementation to make it conform with the specification. In preparation for doing so, we have introduced the IdentityTransformStream class that implements behavior identical to the current TransformStream class. This type of stream forwards all chunks of byte data (in the form of TypedArrays) written to its writable side to its readable side, without any changes.

The IdentityTransformStream readable side supports bring your own buffer (BYOB) reads ↗.
Constructor

let { readable, writable } = new IdentityTransformStream();

    IdentityTransformStream() IdentityTransformStream
        Returns a new identity transform stream.

Properties

    readable ReadableStream
        An instance of a ReadableStream.
    writable WritableStream
        An instance of a WritableStream.

FixedLengthStream

The FixedLengthStream is a specialization of IdentityTransformStream that limits the total number of bytes that the stream will passthrough. It is useful primarily because, when using FixedLengthStream to produce either a Response or Request, the fixed length of the stream will be used as the Content-Length header value as opposed to use chunked encoding when using any other type of stream. An error will occur if too many, or too few bytes are written through the stream.
Constructor

let { readable, writable } = new FixedLengthStream(1000);

    FixedLengthStream(length) FixedLengthStream
        Returns a new identity transform stream.
        length maybe a number or bigint with a maximum value of 2^53 - 1.

Properties

    readable ReadableStream
        An instance of a ReadableStream.
    writable WritableStream
        An instance of a WritableStream.

Related resources

    Streams
    Transform Streams in the WHATWG Streams API specification ↗

WritableStream
Background

A WritableStream is the writable property of a TransformStream. On the Workers platform, WritableStream cannot be directly created using the WritableStream constructor.

A typical way to write to a WritableStream is to pipe a ReadableStream to it.

readableStream
  .pipeTo(writableStream)
  .then(() => console.log('All data successfully written!'))
  .catch(e => console.error('Something went wrong!', e));

To write to a WritableStream directly, you must use its writer.

const writer = writableStream.getWriter();
writer.write(data);

Refer to the WritableStreamDefaultWriter documentation for further detail.
Properties

    locked boolean
        A Boolean value to indicate if the writable stream is locked to a writer.

Methods

abort(reasonstringoptional) : Promise<void>

    Aborts the stream. This method returns a promise that fulfills with a response undefined. reason is an optional human-readable string indicating the reason for cancellation. reason will be passed to the underlying sink’s abort algorithm. If this writable stream is one side of a TransformStream, then its abort algorithm causes the transform’s readable side to become errored with reason.

    Warning

    Any data not yet written is lost upon abort.

    getWriter() : WritableStreamDefaultWriter
        Gets an instance of WritableStreamDefaultWriter and locks the WritableStream to that writer instance.

Related resources

    Streams
    Writable streams in the WHATWG Streams API specification ↗

WritableStream DefaultWriter
Background

A writer is used when you want to write directly to a WritableStream, rather than piping data to it from a ReadableStream. For example:

function writeArrayToStream(array, writableStream) {
  const writer = writableStream.getWriter();
  array.forEach(chunk => writer.write(chunk).catch(() => {}));

  return writer.close();
}

writeArrayToStream([1, 2, 3, 4, 5], writableStream)
  .then(() => console.log('All done!'))
  .catch(e => console.error('Error with the stream: ' + e));

Properties

    writer.desiredSize int
        The size needed to fill the stream’s internal queue, as an integer. Always returns 1, 0 (if the stream is closed), or null (if the stream has errors).

    writer.closed Promise<void>
        A promise that indicates if the writer is closed. The promise is fulfilled when the writer stream is closed and rejected if there is an error in the stream.

Methods

abort(reasonstringoptional) : Promise<void>

    Aborts the stream. This method returns a promise that fulfills with a response undefined. reason is an optional human-readable string indicating the reason for cancellation. reason will be passed to the underlying sink’s abort algorithm. If this writable stream is one side of a TransformStream, then its abort algorithm causes the transform’s readable side to become errored with reason.

    Warning

    Any data not yet written is lost upon abort.

    close() : Promise<void>
        Attempts to close the writer. Remaining writes finish processing before the writer is closed. This method returns a promise fulfilled with undefined if the writer successfully closes and processes the remaining writes, or rejected on any error.

    releaseLock() : void
        Releases the writer’s lock on the stream. Once released, the writer is no longer active. You can call this method before all pending write(chunk) calls are resolved. This allows you to queue a write operation, release the lock, and begin piping into the writable stream from another source, as shown in the example below.

let writer = writable.getWriter();
// Write a preamble.
writer.write(new TextEncoder().encode('foo bar'));
// While that’s still writing, pipe the rest of the body from somewhere else.
writer.releaseLock();
await someResponse.body.pipeTo(writable);

    write(chunkany) : Promise<void>
        Writes a chunk of data to the writer and returns a promise that resolves if the operation succeeds.
        The underlying stream may accept fewer kinds of type than any, it will throw an exception when encountering an unexpected type.

