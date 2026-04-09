const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

class HakunekoDownloader {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 8388608; 
        this.throttle = options.throttle || 0;
        this.maxConcurrent = options.maxConcurrent || 5;
    }

    async _wait(delay) {
        if (!delay) return;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    async downloadMp4(url, outputFile, headers = {}, onProgress = null) {

        const headRes = await axios.head(url, { headers, maxRedirects: 5 }).catch(e => e.response);
        let size = headRes && headRes.headers['content-length'];

        if (!size) {

            console.log("No Content-Length found, falling back to basic stream download.");
            return this._basicDownload(url, outputFile, headers);
        }

        size = parseInt(size, 10);
        let part = this.chunkSize;
        let chunksCount = Math.ceil(size / part);
        let chunks = [];
        for (let i = 0; i < chunksCount; i++) {
            let start = i * part;
            let end = Math.min(start + part - 1, size - 1);
            chunks.push({ start, end, index: i });
        }

        let tempFiles = [];
        let downloaded = 0;
        const tempDir = `${outputFile}.tmpdir`;
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const runChunk = async (chunk) => {
            const tempFile = path.join(tempDir, `part_${String(chunk.index).padStart(5, '0')}`);
            tempFiles[chunk.index] = tempFile;

            if (fs.existsSync(tempFile)) {
                const stat = fs.statSync(tempFile);
                if (stat.size === (chunk.end - chunk.start + 1)) {
                    downloaded += stat.size;
                    return; 
                }
            }

            const chunkHeaders = { ...headers, Range: `bytes=${chunk.start}-${chunk.end}` };
            const res = await axios.get(url, { headers: chunkHeaders, responseType: 'stream' });

            return new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(tempFile);
                res.data.pipe(writer);
                let localDownloaded = 0;
                res.data.on('data', d => {
                    localDownloaded += d.length;
                    downloaded += d.length;
                    if (onProgress) onProgress(downloaded / size);
                });
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        };

        await this._runWithConcurrency(chunks, runChunk, this.maxConcurrent);

        const outStream = fs.createWriteStream(outputFile);
        for (let tmpFile of tempFiles) {
            await new Promise((resolve, reject) => {
                const inStream = fs.createReadStream(tmpFile);
                inStream.pipe(outStream, { end: false });
                inStream.on('end', resolve);
                inStream.on('error', reject);
            });
        }
        outStream.end();

        for (let tmpFile of tempFiles) {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        }
        fs.rmdirSync(tempDir);
    }

    async downloadHls(playlistUrl, outputFile, headers = {}, onProgress = null) {
        const res = await axios.get(playlistUrl, { headers });
        let playlist = res.data;
        const baseUrl = new URL(playlistUrl);

        if (playlist.includes('#EXT-X-STREAM-INF')) {
            let lines = playlist.split('\n').map(l => l.trim()).filter(Boolean);
            let subPlaylists = [];
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {

                    let nextLine = lines[i + 1];
                    if (nextLine && !nextLine.startsWith('#')) {
                        let u = new URL(nextLine, baseUrl);
                        if (!nextLine.includes('?')) {
                            baseUrl.searchParams.forEach((v, k) => u.searchParams.set(k, v));
                        }
                        subPlaylists.push(u.toString());
                    }
                }
            }
            if (subPlaylists.length > 0) {

                console.log("Master Playlist detected, resolving to sub-playlist: " + subPlaylists[0]);
                return this.downloadHls(subPlaylists[0], outputFile, headers, onProgress);
            }
        }

        let packets = [...new Set(playlist.match(/^[^\s#].+$/gm))];
        let packetTasks = packets.map((packet, index) => {
            const u = new URL(packet, baseUrl);
            if (!packet.includes('?')) {
                baseUrl.searchParams.forEach((v, k) => u.searchParams.set(k, v));
            }
            return {
                original: packet,
                source: u.toString(),
                target: `part_${String(index).padStart(5, '0')}.ts`
            };
        });

        let keyMatch = playlist.match(/URI\s*=\s*"(.*?)"/);
        if (keyMatch && keyMatch[1]) {
            const u = new URL(keyMatch[1], baseUrl);
            if (!keyMatch[1].includes('?')) {
                baseUrl.searchParams.forEach((v, k) => u.searchParams.set(k, v));
            }
            packetTasks.push({
                original: keyMatch[1],
                source: u.toString(),
                target: 'media.key'
            });
        }

        const tempDir = `${outputFile}.tmpdir`;
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        let downloadedSegments = 0;
        const totalSegments = packetTasks.length; 

        let localPlaylist = playlist;
        for (let packet of packetTasks) {
            localPlaylist = localPlaylist.split(packet.original).join(packet.target);
        }
        fs.writeFileSync(path.join(tempDir, 'media.m3u8'), localPlaylist);

        const runChunk = async (packet) => {
            const tempFile = path.join(tempDir, packet.target);
            if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
                const pRes = await axios.get(packet.source, { headers, responseType: 'stream' }).catch(err => {
                    throw new Error(`Failed to download ${packet.source}: ${err.message}`);
                });
                await new Promise((resolve, reject) => {
                    const writer = fs.createWriteStream(tempFile);
                    pRes.data.pipe(writer);
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
            }
            downloadedSegments++;
            if (onProgress) onProgress(downloadedSegments / totalSegments);
        };

        await this._runWithConcurrency(packetTasks, runChunk, this.maxConcurrent);

        const localM3u8 = path.join(tempDir, 'media.m3u8');
        await new Promise((resolve, reject) => {
            const args = [
                '-y',
                '-allowed_extensions', 'ALL',
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-i', 'media.m3u8',
                '-c', 'copy',
                path.resolve(outputFile)
            ];
            const proc = spawn('ffmpeg', args, { cwd: tempDir });
            let errOutput = "";
            proc.stderr.on('data', d => errOutput += d.toString());
            proc.on('exit', code => {
                if (code === 0) resolve();
                else reject(new Error('ffmpeg error ' + code + '\n' + errOutput));
            });
            proc.on('error', reject);
        });

        // Cleanup
        for (let packet of packetTasks) {
            const f = path.join(tempDir, packet.target);
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        fs.unlinkSync(localM3u8);
        fs.rmdirSync(tempDir);
    }

    async _basicDownload(url, outputFile, headers) {
        const response = await axios.get(url, { responseType: "stream", headers });
        const writer = fs.createWriteStream(outputFile);
        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on("finish", resolve);
            writer.on("error", reject);
        });
    }

    async _runWithConcurrency(tasks, handler, concurrency) {
        let index = 0;
        const workers = Array(concurrency).fill(null).map(async () => {
            while (index < tasks.length) {
                const i = index++;
                await handler(tasks[i]);
            }
        });
        await Promise.all(workers);
    }
}

module.exports = HakunekoDownloader;
