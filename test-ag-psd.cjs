const { writePsdUint8Array, readPsd } = require('ag-psd');
const psdObject = {
  width: 100,
  height: 100,
  children: [
    {
      name: "test.png",
      imageData: {
        width: 100,
        height: 100,
        data: new Uint8ClampedArray(100 * 100 * 4)
      }
    }
  ]
};

try {
  const buffer = writePsdUint8Array(psdObject).buffer;
  console.log("Success! Buffer size:", buffer.byteLength);
  
  const parsed = readPsd(buffer);
  console.log("Parsed children length:", parsed.children.length);
  if (parsed.children.length > 0) {
    console.log("First child has imageData:", !!parsed.children[0].imageData);
    console.log("First child name:", parsed.children[0].name);
  }
} catch (e) {
  console.error("Error:", e);
}
