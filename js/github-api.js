import { Octokit } from "@octokit/rest";
import { v4 as uuidv4 } from "uuid";

// Configure paths
const BASE_DATA_PATH = 'data';

export class GithubApi {
    constructor(owner, repo, pat) {
        this.owner = owner;
        this.repo = repo;
        this.octokit = new Octokit({ auth: pat });
    }

    /**
     * Fetch all JSON files within specific month directory
     */
    async getMonthData(year, month) {
        const dirPath = `${BASE_DATA_PATH}/${year}/${month}`;
        try {
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: dirPath,
            });

            if (!Array.isArray(data)) return [];

            let monthLedger = [];
            // Fetch contents of all json files in parallel
            const filePromises = data.filter(file => file.name.endsWith('.json')).map(async (file) => {
                try {
                    const fileContent = await this.octokit.rest.repos.getContent({
                        owner: this.owner,
                        repo: this.repo,
                        path: file.path,
                    });

                    const decoded = decodeURIComponent(escape(window.atob(fileContent.data.content)));
                    const items = JSON.parse(decoded);
                    // Legacy Support: ensuring all items have an ID
                    items.forEach(item => {
                        if (!item.id) item.id = uuidv4();
                    });
                    return items;
                } catch (err) {
                    console.error("Failed to fetch file:", file.path, err);
                    return [];
                }
            });

            const results = await Promise.all(filePromises);
            results.forEach(arr => {
                monthLedger = monthLedger.concat(arr);
            });

            return monthLedger;
        } catch (error) {
            // 404 means directory doesn't exist yet, which is fine
            if (error.status === 404) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Syncs a single day's file
     */
    async syncSingleFile(filePath, queueItems) {
        let currentSha = null;
        let remoteItems = [];

        try {
            // 1. Fetch current remote
            const { data } = await this.octokit.rest.repos.getContent({
                owner: this.owner,
                repo: this.repo,
                path: filePath,
            });
            currentSha = data.sha;
            remoteItems = JSON.parse(decodeURIComponent(escape(window.atob(data.content))));
        } catch (err) {
            if (err.status !== 404) throw err;
            // 404 = New file, remoteItems stays []
        }

        // 2. Merge logic (Remote + Queue Items)
        let mergedObj = {};

        // Populate remote first
        remoteItems.forEach(item => {
            if (!item.id) item.id = uuidv4();
            mergedObj[item.id] = item;
        });

        // Apply queue items (ordered by timestamp implicitly as they were pushed)
        queueItems.forEach(qItem => {
            if (qItem._action === 'delete') {
                delete mergedObj[qItem.id];
            } else {
                mergedObj[qItem.id] = { ...qItem };
                delete mergedObj[qItem.id]._action; // clean before uploading
                delete mergedObj[qItem.id].timestamp;
            }
        });

        const finalItems = Object.values(mergedObj);

        // Delete file if empty, else update
        if (finalItems.length === 0) {
            if (currentSha) {
                await this.octokit.rest.repos.deleteFile({
                    owner: this.owner,
                    repo: this.repo,
                    path: filePath,
                    message: `Delete empty ledger file via PWA`,
                    sha: currentSha
                });
            }
        } else {
            const encodeStr = window.btoa(unescape(encodeURIComponent(JSON.stringify(finalItems, null, 2))));
            const params = {
                owner: this.owner,
                repo: this.repo,
                path: filePath,
                message: `Sync ledger via PWA`,
                content: encodeStr
            };
            if (currentSha) params.sha = currentSha;

            await this.octokit.rest.repos.createOrUpdateFileContents(params);
        }
    }
}
