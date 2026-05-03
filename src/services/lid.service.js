const fs = require('fs');

class LidService {
    constructor(lidMapPath) {
        this.lidMapPath = lidMapPath;
        this.lidMap = this.loadLidMap();
    }

    loadLidMap() {
        if (fs.existsSync(this.lidMapPath)) {
            try {
                return JSON.parse(fs.readFileSync(this.lidMapPath, 'utf-8'));
            } catch (e) {
                return {};
            }
        }
        return {};
    }

    saveLidMap() {
        fs.writeFileSync(this.lidMapPath, JSON.stringify(this.lidMap, null, 2));
    }

    get(lid) {
        return this.lidMap[lid];
    }

    set(lid, jid) {
        this.lidMap[lid] = jid;
        this.saveLidMap();
    }
}

module.exports = LidService;
