// const Chunk = require("./Chunk");
const crypto = require("crypto");
const client = require("https")
const fs = require("fs");
const path = require("path")

class File {

    constructor(options) {
        const { url, chunkCount, fileSize, fileName, token, downloadPath } = options;
        this.url = url;
        this.fileSize = fileSize;
        this.fileName = fileName;
        this.chunkCount = chunkCount;
        this.token = token;
        this.downloadPath = path.resolve(downloadPath, fileName);
        this.chunkPath = path.resolve(path.dirname(require.main.filename), "chunks", fileName);

        this.progressBarUpdateCallback = options.progressBarUpdateCallback || undefined;
        this.progressBarStopCallback = options.progressBarStopCallback || undefined;
    }

    static Sleep = (time) => {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve();
            }, time)
        })
    }

    static GetJSON = (url) => {
        return new Promise(resolve => {
            client.get(url, res => {
                let data = "";

                res.on("data", d => {
                    data += d;
                })

                res.on("close", () => {
                    resolve(data);
                })
            })
        })
    }

    static GetToken = async () => {
        let tokenData = JSON.parse(await File.GetJSON("https://api.gofile.io/createAccount"));
        while (tokenData.status == "error-rateLimit") {
            tokenData = JSON.parse(await File.Sleep(Math.random() * 1000)
                .then(() => File.GetJSON("https://api.gofile.io/createAccount")))
        }
        let detailData = JSON.parse(await File.GetJSON(`https://api.gofile.io/getAccountDetails?token=${tokenData.data.token}`));
        if (detailData.status != "ok") {
            throw new Error(detailData.status)
        }
        return tokenData.data.token;
    }

    static formatBytes = (bytes, decimals = 1) => {
        if (bytes === 0) return '0 Bytes';
    
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
        const i = Math.floor(Math.log(bytes) / Math.log(k));
    
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    static MergeChunks = async (filePaths, targetPath) => {
        let filePath = filePaths.pop();
        filePaths.length > 0 && await File.MergeChunks(filePaths, targetPath);
        return new Promise(resolve => {
            if (!fs.existsSync(path.dirname(targetPath))) {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true })
            }
            fs.createReadStream(filePath)
                .pipe(fs.createWriteStream(targetPath, {
                    flags: "a"
                }))
                .once("close", () => {
                    fs.unlink(filePath, () => { });
                    resolve(filePath);
                })
        })
    }

    async StartDownload() {
        let bytesPerChunks = [...Array.from({ length: this.chunkCount }).keys()]
            .map(() => Math.ceil(this.fileSize / this.chunkCount));
        if (!fs.existsSync(this.chunkPath)) {
            fs.mkdirSync(this.chunkPath, { recursive: true });
        } else {
            fs.readdirSync(this.chunkPath).forEach(file => {
                fs.unlinkSync(path.resolve(this.chunkPath, file));
            })
        }

        let currSize = 0;
        let interval = setInterval(() => {
            let files = fs.readdirSync(this.chunkPath);
            let size = files
                .map(file => fs.statSync(path.resolve(this.chunkPath, file)).size)
                .reduce((a, b) => a + b, 0);
            this.progressBarUpdateCallback && this.progressBarUpdateCallback(size, {
                currDownloadSpeed: `${File.formatBytes(size - currSize)}/s`,
                currFormatSize: File.formatBytes(size)
            });
            currSize = size;
            if (currSize == this.fileSize) {
                clearInterval(interval);
            }
        }, 1000);
        let filePaths = await Promise.all(bytesPerChunks.map((chunkCount, index) => this.DownloadChunk(index, chunkCount)));
        clearInterval(interval)
        await File.MergeChunks(filePaths, this.downloadPath);
        fs.rmSync(this.chunkPath, { recursive: true, force: true });
        this.progressBarUpdateCallback && this.progressBarUpdateCallback(this.fileSize);
    }


    DownloadChunk(index, chunkSize) {
        const downloadPath = path.resolve(this.chunkPath, `${this.fileName}.part${index + 1}`)
        const from = index * chunkSize;
        const end = Math.min(this.fileSize, (index + 1) * chunkSize) - 1;
        const options = {
            headers: {
                "Accept-Encoding": "gzip, deflate, br",
                "Cookie": "accountToken=" + this.token,
                "Range": `bytes=${from}-${end}`
            }
        }
        return new Promise((resolve, reject) => {
            client.get(this.url, options, (res => {
                if (Math.floor(res.statusCode / 100) == 2) {
                    res.pipe(fs.createWriteStream(downloadPath))
                        .once("close", () => {
                            resolve(downloadPath)
                        });
                } else {
                    resolve(this.DownloadChunk(index, chunkSize));
                    // reject(new Error(`[${res.statusCode}] ${res.statusMessage}`))
                }
            }))
        })
            .catch(err => {
                console.error(err);
            })
    }
}

module.exports = File;