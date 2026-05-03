import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { execSync } from 'child_process';

interface RamInfo {
  total: number;
  used: number;
  available: number;
  buffers: number;
  cached: number;
  percent: number;
  swapTotal: number;
  swapUsed: number;
  swapFree: number;
  swapPercent: number;
}

interface LoadAvg {
  '1min': number;
  '5min': number;
  '15min': number;
}

interface CpuInfo {
  usagePercent: number;
  modelName: string;
  cores: number;
  loadAvg: LoadAvg | null;
  temp: number | null;
  uptimeSeconds: number;
}

interface DiskInfo {
  total: number;
  used: number;
  available: number;
  percent: number;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) {
      return authResult.response;
    }

    // RAM info from /proc/meminfo (works on Linux)
    let ram: RamInfo | null = null;
    try {
      const meminfo = execSync('cat /proc/meminfo', { encoding: 'utf-8', timeout: 3000 });
      const parseLine = (key: string) => {
        const match = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
        return match ? parseInt(match[1]) * 1024 : 0; // Convert kB to bytes
      };

      const total = parseLine('MemTotal');
      const available = parseLine('MemAvailable');
      const used = total - available;
      const buffers = parseLine('Buffers');
      const cached = parseLine('Cached');
      const swapTotal = parseLine('SwapTotal');
      const swapFree = parseLine('SwapFree');
      const swapUsed = swapTotal - swapFree;

      ram = {
        total,
        used,
        available,
        buffers,
        cached,
        percent: total > 0 ? Math.round((used / total) * 100) : 0,
        swapTotal,
        swapUsed,
        swapFree,
        swapPercent: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 100) : 0,
      };
    } catch {
      // Fallback: try free command
      try {
        const freeOutput = execSync('free -b 2>/dev/null | grep Mem', { encoding: 'utf-8', timeout: 3000 });
        const parts = freeOutput.trim().split(/\s+/);
        const total = parseInt(parts[1]) || 0;
        const used = parseInt(parts[2]) || 0;
        const available = parseInt(parts[6]) || 0;
        ram = {
          total,
          used,
          available,
          buffers: 0,
          cached: 0,
          percent: total > 0 ? Math.round((used / total) * 100) : 0,
          swapTotal: 0,
          swapUsed: 0,
          swapFree: 0,
          swapPercent: 0,
        };
      } catch {
        ram = null;
      }
    }

    // CPU info
    let cpu: CpuInfo | null = null;
    try {
      // CPU usage: read from /proc/stat twice with small interval
      const readCpuTimes = () => {
        const stat = execSync('cat /proc/stat | head -1', { encoding: 'utf-8', timeout: 3000 });
        const parts = stat.trim().split(/\s+/);
        return parts.slice(1).map(Number);
      };

      const t1 = readCpuTimes();
      // Wait 200ms — use async sleep instead of busy-wait to avoid blocking event loop
      await new Promise(resolve => setTimeout(resolve, 200));
      const t2 = readCpuTimes();

      const diffs = t2.map((v, i) => v - (t1[i] || 0));
      const totalDiff = diffs.reduce((a, b) => a + b, 0);
      const idleDiff = (diffs[3] || 0) + (diffs[4] || 0); // idle + iowait
      const usagePercent = totalDiff > 0 ? Math.round(((totalDiff - idleDiff) / totalDiff) * 100) : 0;

      // CPU model name
      let modelName = '';
      try {
        const cpuInfo = execSync('cat /proc/cpuinfo | grep "model name" | head -1', { encoding: 'utf-8', timeout: 3000 });
        modelName = cpuInfo.split(':').slice(1).join(':').trim();
      } catch {
        // ARM devices might use "Hardware" or "Model" instead
        try {
          const hwInfo = execSync('cat /proc/cpuinfo | grep -E "Hardware|Model" | head -1', { encoding: 'utf-8', timeout: 3000 });
          modelName = hwInfo.split(':').slice(1).join(':').trim() || 'ARM Processor';
        } catch { modelName = 'ARM Processor'; }
      }

      // CPU cores
      let cores = 0;
      try {
        const coreInfo = execSync('nproc 2>/dev/null || cat /proc/cpuinfo | grep "processor" | wc -l', { encoding: 'utf-8', timeout: 3000 });
        cores = parseInt(coreInfo.trim()) || 1;
      } catch { cores = 1; }

      // Load average
      let loadAvg: LoadAvg | null = null;
      try {
        const loadStr = execSync('cat /proc/loadavg', { encoding: 'utf-8', timeout: 3000 });
        const parts = loadStr.trim().split(/\s+/);
        loadAvg = {
          '1min': parseFloat(parts[0]) || 0,
          '5min': parseFloat(parts[1]) || 0,
          '15min': parseFloat(parts[2]) || 0,
        };
      } catch { /* empty */ }

      // CPU temperature
      let temp: number | null = null;
      try {
        const tempStr = execSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
        const tempVal = parseInt(tempStr.trim());
        temp = tempVal > 1000 ? tempVal / 1000 : tempVal; // Some report in millidegrees
      } catch { /* empty */ }

      // Uptime
      let uptimeSeconds = 0;
      try {
        const uptimeStr = execSync('cat /proc/uptime', { encoding: 'utf-8', timeout: 3000 });
        uptimeSeconds = parseFloat(uptimeStr.split(' ')[0]) || 0;
      } catch { /* empty */ }

      cpu = {
        usagePercent,
        modelName: modelName || 'ARM Processor',
        cores,
        loadAvg,
        temp,
        uptimeSeconds,
      };
    } catch {
      cpu = null;
    }

    // Disk info
    let disk: DiskInfo | null = null;
    try {
      const dfOutput = execSync("df -B1 / | tail -1", { encoding: 'utf-8', timeout: 3000 });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 5) {
        const totalBytes = parseInt(parts[1]) || 0;
        const usedBytes = parseInt(parts[2]) || 0;
        const availableBytes = parseInt(parts[3]) || 0;
        disk = {
          total: totalBytes,
          used: usedBytes,
          available: availableBytes,
          percent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
        };
      }
    } catch { disk = null; }

    return NextResponse.json({
      success: true,
      data: { ram, cpu, disk, timestamp: Date.now() },
    });
  } catch (error: any) {
    console.error('System stats API error:', error);
    return NextResponse.json({ success: false, error: 'Gagal mengambil info sistem' }, { status: 500 });
  }
}
