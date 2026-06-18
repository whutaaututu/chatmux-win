import { readFile, writeFile, copyFile, rename, unlink, stat, mkdir, rm } from "fs/promises";
import { join, dirname, basename } from "path";
import { createReadStream, createWriteStream } from "fs";
import { EventEmitter } from "events";

// 传输任务管理器
class TransferManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this.nextId = 1;
  }

  // 创建上传任务
  createUploadTask(fileName, targetPath, totalSize) {
    const id = `upload_${this.nextId++}`;
    const task = {
      id,
      type: "upload",
      fileName,
      targetPath,
      totalSize,
      transferred: 0,
      status: "pending", // pending, transferring, completed, failed
      startTime: Date.now(),
      error: null,
    };
    this.tasks.set(id, task);
    this.emit("taskCreated", task);
    return task;
  }

  // 创建下载任务
  createDownloadTask(fileName, sourcePath, totalSize) {
    const id = `download_${this.nextId++}`;
    const task = {
      id,
      type: "download",
      fileName,
      sourcePath,
      totalSize,
      transferred: 0,
      status: "pending",
      startTime: Date.now(),
      error: null,
    };
    this.tasks.set(id, task);
    this.emit("taskCreated", task);
    return task;
  }

  // 更新进度
  updateProgress(id, transferred) {
    const task = this.tasks.get(id);
    if (task) {
      task.transferred = transferred;
      task.status = "transferring";
      this.emit("progress", task);
    }
  }

  // 完成任务
  completeTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.transferred = task.totalSize;
      task.status = "completed";
      this.emit("completed", task);
      // 5 秒后自动清理
      setTimeout(() => this.tasks.delete(id), 5000);
    }
  }

  // 任务失败
  failTask(id, error) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = "failed";
      task.error = error;
      this.emit("failed", task);
      setTimeout(() => this.tasks.delete(id), 10000);
    }
  }

  // 获取所有任务
  getAllTasks() {
    return [...this.tasks.values()];
  }

  // 获取任务
  getTask(id) {
    return this.tasks.get(id);
  }

  // 清除已完成的任务
  clearCompleted() {
    for (const [id, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed") {
        this.tasks.delete(id);
      }
    }
  }
}

// 文件剪贴板
class FileClipboard {
  constructor() {
    this.items = []; // { path, name, operation: 'copy' | 'cut' }
  }

  // 复制文件
  copy(files) {
    this.items = files.map(f => ({ ...f, operation: "copy" }));
  }

  // 剪切文件
  cut(files) {
    this.items = files.map(f => ({ ...f, operation: "cut" }));
  }

  // 粘贴到目标目录
  async paste(targetDir) {
    const results = [];
    const failedItems = [];

    for (const item of this.items) {
      try {
        const targetPath = join(targetDir, item.name);

        // 检查目标文件是否已存在
        let finalPath = targetPath;
        let counter = 1;
        while (true) {
          try {
            await stat(finalPath);
            // 文件存在，添加后缀
            const ext = item.name.includes(".") ? "." + item.name.split(".").pop() : "";
            const nameWithoutExt = item.name.replace(ext, "");
            finalPath = join(targetDir, `${nameWithoutExt}_${counter}${ext}`);
            counter++;
          } catch {
            break; // 文件不存在，可以使用这个路径
          }
        }

        if (item.operation === "copy") {
          await copyFile(item.path, finalPath);
          results.push({ success: true, from: item.path, to: finalPath, operation: "copy" });
        } else if (item.operation === "cut") {
          await rename(item.path, finalPath);
          results.push({ success: true, from: item.path, to: finalPath, operation: "cut" });
        }
      } catch (e) {
        results.push({ success: false, from: item.path, error: e.message });
        failedItems.push(item);
      }
    }

    // 如果是剪切操作，只保留失败的项目，清空成功的
    if (this.items.length > 0 && this.items[0].operation === "cut") {
      this.items = failedItems;
    }

    return results;
  }

  // 获取剪贴板内容
  getClipboard() {
    return this.items;
  }

}

export const transferManager = new TransferManager();
export const fileClipboard = new FileClipboard();

// 删除文件或目录
async function deleteFile(filePath) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      // 删除目录（递归）
      await rm(filePath, { recursive: true, force: true });
    } else {
      // 删除文件
      await unlink(filePath);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 批量删除
export async function deleteFiles(filePaths) {
  const results = [];
  for (const filePath of filePaths) {
    results.push(await deleteFile(filePath));
  }
  return results;
}
