#pragma once

#include <sqlite3.h>

#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>

#include "sql.h"
#include "xorshift.h"

// The explorer's sample database: an API log with a routes table and one row per request, drawn
// from xorshift32 so the Python reference writes the same rows. /search has a slow tail, /cart
// fails more often in minutes 40-44, and each request keeps its client as JSON.
namespace apilog {

inline int write(const std::string& path, int count, uint32_t seed) {
    if (count < 1 || count > 1000000) throw std::invalid_argument("the sample holds between 1 and 1,000,000 requests");
    std::remove(path.c_str());
    sql::Connection db(path);
    sql::exec(db.get(),
              "create table routes(id integer primary key, path text not null unique, team text not null);"
              "create table requests(id integer primary key, minute integer not null, route_id integer not null references routes(id),"
              " status integer not null, ms integer not null, client text not null check (json_valid(client)));"
              "create index requests_minute on requests(minute);");
    return sql::transaction(db.get(), [&] {
        sql::exec(db.get(), "insert into routes values (1, '/search', 'search'), (2, '/login', 'identity'), (3, '/cart', 'checkout'), (4, '/image', 'media')");
        sql::Statement insert = sql::prepare(db.get(), "insert into requests values (?1, ?2, ?3, ?4, ?5, ?6)");
        static const char* const regions[] = {"eu-west", "us-east", "ap-south"};
        XorShift32 random(seed);
        for (int index = 0; index < count; index += 1) {
            const uint32_t r1 = random.next();
            const uint32_t r2 = random.next();
            const uint32_t r3 = random.next();
            const uint32_t r4 = random.next();
            const uint32_t r5 = random.next();
            const int route = static_cast<int>(r1 % 4) + 1;
            const int minute = index / 1000;
            const int ms = static_cast<int>(20 + r3 % 100 + (route == 1 && r2 % 10 == 0 ? r4 % 2000 : 0));
            const bool failed = (route == 3 && minute >= 40 && minute < 45 && r2 % 5 == 0) || r2 % 200 == 0;
            const std::string client = std::string("{\"region\":\"") + regions[r5 % 3] + "\",\"cache\":\"" + ((r5 / 3) % 4 == 0 ? "hit" : "miss") + "\"}";
            sqlite3_bind_int(insert.get(), 1, index + 1);
            sqlite3_bind_int(insert.get(), 2, minute);
            sqlite3_bind_int(insert.get(), 3, route);
            sqlite3_bind_int(insert.get(), 4, failed ? 500 : 200);
            sqlite3_bind_int(insert.get(), 5, ms);
            sql::bind(insert.get(), 6, client);
            sql::step(db.get(), insert.get());
            sqlite3_reset(insert.get());
        }
        return count;
    });
}

}  // namespace apilog
