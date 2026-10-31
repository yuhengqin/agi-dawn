// Reproducible raster renditions of the repository-native dawn SVG.
import {readFile,writeFile} from "node:fs/promises";
import sharp from "sharp";
const root=new URL("../site/brand/",import.meta.url),svg=await readFile(new URL("logo.svg",root));
for(const [name,size] of [["icon.png",512],["icon-192.png",192],["apple-icon.png",180]] as const)
  await writeFile(new URL(name,root),await sharp(svg).resize(size,size).png().toBuffer());
const png=await sharp(svg).resize(32,32).png().toBuffer(),header=Buffer.alloc(22);
header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=32;header[7]=32;header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
await writeFile(new URL("favicon.ico",root),Buffer.concat([header,png]));
