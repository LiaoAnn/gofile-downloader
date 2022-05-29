require("dotenv").config();
const request = require("request-promise");
const client = require("https")
const fs = require("fs");
const cliProgress = require("git/cli-progress");
const colors = require("ansi-colors");
const { Worker } = require('worker_threads');
const crypto = require("crypto");
const Promise = require("bluebird");
const path = require("path");
const File = require("./Classes/File");
global.Promise = Promise;

const { URL, Password, Thread_Count } = process.env;
const sha256Hash = crypto.createHash("sha256");
const multiBar = new cliProgress.MultiBar({
    format: '"{file}" |{bar}| {percentage}% | {currDownloadSpeed} | {currFormatSize} / {totalFormatSize}',
    hideCursor: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    clearOnComplete: true,
    stopOnComplete: true
});

(async () => {
    if (!fs.existsSync(`./chunks`)) {
        fs.mkdirSync(`./chunks`, { recursive: true });
    }

    multiBar.addListener("stop", () => {
        console.log("Download finish!");
    })

    const token = await File.GetToken();
    let reg = /https:\/\/gofile\.io\/d\/(\w+)/gm;
    let id = reg.exec(URL)[1];
    let parameters = {
        "contentId": id,
        "token": token,
        "websiteToken": "12345",
        "cache": "true",
        "password": Password ? sha256Hash.update(Password).digest("hex") : ""
    }
    let url = `https://api.gofile.io/getContent?${Object.entries(parameters).map(([key, value]) => `${key}=${value}`).join("&")}`;
    const { status, data } = JSON.parse(await File.GetJSON(url));
    if (status != "ok") {
        throw new Error(status);
    }
    const contents = Object.values(data.contents)
        .filter(values => values.type == "file")
        .map(({ link, size, name }) => {
            let bar = multiBar.create(size, 0,
                {
                    file: name,
                    totalFormatSize: File.formatBytes(size)
                }
            );
            const options = {
                url: link,
                fileSize: size,
                fileName: name,
                chunkCount: Thread_Count,
                downloadPath: path.resolve(path.dirname(require.main.filename), "done"),
                token,
                progressBarUpdateCallback: (size, obj) => {
                    bar.update(size, obj);
                },
                progressBarStopCallback: () => {
                    multiBar.update();
                }
            }
            return options;
        });

    await Promise.map(contents, content => {
        let file = new File(content)
        return file.StartDownload();
    }, { concurrency: 3 })
})();