import type { Job, Store } from '../../../packages/lab/src/lib/offline-queue';
export class BrowserStore implements Store {
  constructor(private owner: string) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(`xelra-field-${this.owner}`,1);
      r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});
      r.onerror=()=>reject(Error('This browser could not save the report. Keep this page open and copy your note.'));
      r.onsuccess=()=>resolve(r.result);
    });
  }
  private async run<T>(mode: IDBTransactionMode, action: (s:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('jobs',mode); const request=action(tx.objectStore('jobs'));
      tx.oncomplete=()=>{db.close();resolve(request.result);};
      tx.onerror=tx.onabort=()=>{db.close();reject(Error('The report could not be saved on this device.'));};
    });
  }
  async put(job:Job) { await this.run('readwrite',s=>s.put(job)); }
  async remove(id:string) { await this.run('readwrite',s=>s.delete(id)); }
  async all() { return this.run<Job[]>('readonly',s=>s.getAll()); }
}
