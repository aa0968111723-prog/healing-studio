import { getDatabaseManager } from "../../_core/DatabaseManager";

export abstract class BaseRepository {
  protected get db() {
    return getDatabaseManager();
  }
}
