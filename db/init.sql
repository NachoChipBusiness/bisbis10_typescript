CREATE TABLE restaurants (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    is_kosher BOOLEAN NOT NULL
);

CREATE TABLE ratings (
    restaurant_id INT REFERENCES restaurants(id) ON DELETE CASCADE,
    rating DOUBLE PRECISION NOT NULL
);

CREATE TABLE cuisines (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE restaurant_cuisines (
    restaurant_id INT REFERENCES restaurants(id) ON DELETE CASCADE,
    cuisine_id INT REFERENCES cuisines(id) ON DELETE CASCADE,
    PRIMARY KEY (restaurant_id, cuisine_id)
);

CREATE TABLE dishes (
    id SERIAL PRIMARY KEY,
    restaurant_id INT REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price INT NOT NULL
);