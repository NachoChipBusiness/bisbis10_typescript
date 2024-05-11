import { Request, Response, Router } from "express";
import pgClient from "../db/db";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Express & TypeScript Server");
});

// ################ Verifying Queries ################ //

async function doesRestaurantExist(id: number) {
    const result = await pgClient.query(
        `SELECT EXISTS (
            SELECT 1
            FROM restaurants
            WHERE id = $1
         ) AS id_exists;`,
        [id]
    );

    return result.rows[0].id_exists as boolean;
}

async function doesDishExist(id: number) {
    const result = await pgClient.query(
        `SELECT EXISTS (
            SELECT 1
            FROM dishes
            WHERE id = $1
         ) AS id_exists;`,
        [id]
    );

    return result.rows[0].id_exists as boolean;
}

async function doesDishBelongToRestaurant(dishId: number, restaurantId: number) {
    const result = await pgClient.query(
        `SELECT EXISTS (
            SELECT 1
            FROM dishes
            WHERE id = $1 AND restaurant_id = $2
         ) AS id_exists;`,
        [dishId, restaurantId]
    );

    return result.rows[0].id_exists as boolean;
}

// ################ Restaurants APIs ################ //

// Returns an object with property "rows" containing an array of json objects
// each contains a reataurant data as define in the excersice for "Get all restaurants".
// A restaurant without any rating receives a -1 rating
async function getAllRestaurants() {
    const result = await pgClient.query(
        `SELECT 
            (re.id)::text AS "id", 
            re.name AS "name", 
            
            -- Getting the ratings of each restaurant grouped and calculated to the average of all the ratings.
            -- If no ratings for the restaurant, there is a default -1 given.
            -- ROUND is making the number to have only the top 2 most significant digits after the decimal floating point.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that let you aggregate grouped values into a single list.
            -- FILTER lets you have NULL in case there are no cuisines assigned to the given restaurant
            -- and using the COALESCE an empty list is returned instead.
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') AS "cuisines"
         FROM restaurants re
         LEFT JOIN ratings ON re.id = ratings.restaurant_id
         LEFT JOIN restaurant_cuisines re_cu ON re.id = re_cu.restaurant_id
         LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
         GROUP BY re.id;`
    );

    return result;
}

async function getRestaurantsByCuisine(cuisine: string) {
    const result = await pgClient.query(
        `SELECT 
            (re.id)::text AS "id", 
            re.name AS "name", 
            
            -- Getting the ratings of each restaurant grouped and calculated to the average of all the ratings.
            -- If no ratings for the restaurant, there is a default -1 given.
            -- ROUND is making the number to have only the top 2 most significant digits after the decimal floating point.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that let you aggregate grouped values into a single list.
            -- FILTER lets you have NULL in case there are no cuisines assigned to the given restaurant
            -- and using the COALESCE an empty list is returned instead.
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') AS "cuisines"
         FROM restaurants re
         LEFT JOIN ratings ON re.id = ratings.restaurant_id
         JOIN restaurant_cuisines re_cu ON re.id = re_cu.restaurant_id AND re_cu.restaurant_id IN (
            SELECT re_cu2.restaurant_id
            FROM restaurant_cuisines re_cu2
            JOIN cuisines cu2 ON re_cu2.cuisine_id = cu2.id
            WHERE cu2.name = $1
         )
         LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
         GROUP BY re.id;`,
        [cuisine]
    );

    return result;
}

router.get("/restaurants", async (req: Request, res: Response) => {
    try {
        let result;
        if ( req.query.constructor === Object && Object.keys(req.query).length === 0 ) {
            // console.log("/restaurants");
            result = await getAllRestaurants();
        } else {
            // console.log(req.query);
            // console.log("/restaurants?cuisine=...");
            if (req.query["cuisine"] === undefined) {
                throw new Error("Bad Request: no keyword \"cuisine\" in query path.")
            }
            const cuisine: string = req.query["cuisine"] as string;
            result = await getRestaurantsByCuisine(cuisine);
        }
        res.status(200).json(result.rows);
    } catch (err) {
        console.log(err);
        res.status(400).send(err);
    }
});

async function getRestaurant(restaurantId: number) {
    const rawRestaurantInfo = await pgClient.query(
        `SELECT 
            (re.id)::text as "id", 
            re.name as "name", 
            
            -- Getting the ratings of each restaurant grouped and calculated to the average of all the ratings.
            -- If no ratings for the restaurant, there is a default -1 given.
            -- ROUND is making the number to have only the top 2 most significant digits after the decimal floating point.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that let you aggregate grouped values into a single list.
            -- FILTER lets you have NULL in case there are no cuisines assigned to the given restaurant
            -- and using the COALESCE an empty list is returned instead.
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') as "cuisines"
         
         FROM restaurants re
         LEFT JOIN ratings ON re.id = ratings.restaurant_id
         LEFT JOIN restaurant_cuisines re_cu ON re.id = re_cu.restaurant_id
         LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
         WHERE re.id = $1
         GROUP BY re.id;`,
        [restaurantId]
    );

    let restaurantInfo = rawRestaurantInfo.rows[0];

    const rawRestaurantDishes = await pgClient.query(
        `SELECT id::text, name, description, price
         FROM dishes
         WHERE restaurant_id = $1`,
        [restaurantId]
    );

    restaurantInfo["dishes"] = rawRestaurantDishes.rows;

    return restaurantInfo;
}

router.get("/restaurants/:id", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }

        const restaurantInfo = await getRestaurant(restaurantId);
        res.status(200).json(restaurantInfo);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function addRestaurant(name: string, isKosher: boolean, cuisines: string[]) {
    const addRestaurantQueryString = `INSERT INTO restaurants (name, is_kosher) VALUES ('${name}', ${isKosher}) RETURNING id`
    const cuisinesValues = cuisines.map(cuisine => `('${cuisine}')`).join(', ')
    const addCuisinesQueryString = `INSERT INTO cuisines (name) VALUES ${cuisinesValues} ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    
    await pgClient.query(
        `WITH restaurant AS (${addRestaurantQueryString}),
         restaurant_cuisines AS (${addCuisinesQueryString})
         INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
         SELECT re.id, cu.id
         -- Using recieved information from restaurant and restaurant_cuisines nested-queries
         -- to achieve the third INSERT INTO query.
         FROM restaurant re, restaurant_cuisines cu`
    )
}

router.post("/restaurants", async (req: Request, res: Response) => {
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: string[] = req.body["cuisines"];

    try {
        if (restaurantName === undefined || restaurantIsKosher === undefined || restaurantCuisines === undefined) {
            throw new Error("Bad Request Body")
        }
        await addRestaurant(restaurantName, restaurantIsKosher, restaurantCuisines);
        res.sendStatus(201);
    } catch (err) {
        console.log(err);
        res.sendStatus(400);
    }
});

async function updateRestaurant(restaurantId: number, name: string, isKosher: boolean, cuisines: string[]) {
    
    const updateRestaurantNameQueryString = `UPDATE restaurants SET name = '${name}' WHERE id = ${restaurantId};\n`;
    const updateRestaurantIsKosherQueryString = `UPDATE restaurants SET is_kosher = ${isKosher} WHERE id = ${restaurantId};\n`;
    
    let updateRestaurantCuisinesQueryString: string = '';
    if (cuisines !== undefined) {
        const cuisinesValues = cuisines.map(cuisine => `('${cuisine}')`).join(', ');
        const addCuisinesQueryString = `INSERT INTO cuisines (name) VALUES ${cuisinesValues} ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    updateRestaurantCuisinesQueryString = `DELETE FROM restaurant_cuisines re_cu WHERE re_cu.restaurant_id = ${restaurantId};
                                                    WITH restaurant_cuisines AS (${addCuisinesQueryString})
                                                    INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
                                                    SELECT ${restaurantId} AS restaurant_id, cu.id
                                                    -- Using recieved information from restaurant and restaurant_cuisines nested-queries
                                                    -- to achieve the third INSERT INTO query.
                                                    FROM restaurant_cuisines cu;`
    }

    let updateRestaurantQueryString = (name !== undefined ? updateRestaurantNameQueryString : '') + 
                           (isKosher !== undefined ? updateRestaurantIsKosherQueryString : '') +
                           (cuisines !== undefined ? updateRestaurantCuisinesQueryString : '');
    
    await pgClient.query(updateRestaurantQueryString);

    // if (cuisines !== undefined) {
    //     const cuisinesValues = cuisines.map(cuisine => `('${cuisine}')`).join(', ')
    //     const addCuisinesQueryString = `INSERT INTO cuisines (name) VALUES ${cuisinesValues} ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    
    //     await pgClient.query(
    //         `DELETE FROM restaurant_cuisines re_cu
    //          WHERE re_cu.restaurant_id = $1;
             
    //          WITH restaurant_cuisines AS (${addCuisinesQueryString})
    //          INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
    //          SELECT $1 AS restaurant_id, cu.id
    //          -- Using recieved information from restaurant and restaurant_cuisines nested-queries
    //          -- to achieve the third INSERT INTO query.
    //          FROM restaurant_cuisines cu;`,
    //         [restaurantId]
    //     );
    // }
}

router.put("/restaurants/:id", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: string[] = req.body["cuisines"];

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }

        if (restaurantName === undefined && restaurantIsKosher === undefined && restaurantCuisines === undefined) {
            throw new Error("Bad Request Body")
        }

        await updateRestaurant(restaurantId, restaurantName, restaurantIsKosher, restaurantCuisines);
        res.sendStatus(200);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function deleteRestaurant(restaurantId: number) {
    // No need to take care of back-references because we have "ON DELETE CASCADE" in the DB schema
    await pgClient.query(
        `DELETE FROM restaurants
         WHERE id = $1;`,
        [restaurantId]
    );
}

router.delete("/restaurants/:id", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);

    try {
        await deleteRestaurant(restaurantId);
        res.sendStatus(204);
    } catch (err) {
        console.log(err);
        res.sendStatus(404);
    }
});

// ################ Ratings APIs ################ //

async function addRating(restaurantId: number, rating: number) {
    await pgClient.query(
        `INSERT INTO ratings (restaurant_id, rating) VALUES
            ($1, $2);`,
        [restaurantId, rating]
    )
}

router.post("/ratings", async (req: Request, res: Response) => {
    const restaurantId: number = req.body["restaurantId"];
    const restaurantRating: number = req.body["rating"];

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }

        await addRating(restaurantId, restaurantRating);
        res.sendStatus(200);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

// ################ Dishes APIs ################ //

async function addDish(restaurantId: number, name: string, description: string, price: number) {
    await pgClient.query(
        `INSERT INTO dishes (restaurant_id, name, description, price) VALUES
            ($1, $2, $3, $4);`,
        [String(restaurantId), name, description, String(price)] // The placeholders need to be of the same <any> type in order to get approved by typescript
    );
}

router.post("/restaurants/:id/dishes", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishName: string = req.body["name"];
    const dishDescription: string = req.body["description"];
    const dishPrice: number = req.body["price"];

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }

        if (dishName === undefined || dishDescription === undefined || dishPrice === undefined) {
            throw new Error("Bad Request Body. All fields must be provided")
        }

        await addDish(restaurantId, dishName, dishDescription, dishPrice);
        res.sendStatus(201);
        
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function updateDish(dishId: number, name: string, description: string, price: number) {
    const updateDishNameQueryString = `UPDATE dishes SET name = '${name}' WHERE id = ${dishId};\n`;
    const updateDishDescriptionQueryString = `UPDATE dishes SET description = '${description}' WHERE id = ${dishId};\n`;
    const updateDishPriceQueryString = `UPDATE dishes SET price = ${price} WHERE id = ${dishId};`;

    let updateDishQueryString = (name !== undefined ? updateDishNameQueryString : '') + 
                           (description !== undefined ? updateDishDescriptionQueryString : '') +
                           (price !== undefined ? updateDishPriceQueryString : '');
    
    await pgClient.query(updateDishQueryString);
}

router.put("/restaurants/:id/dishes/:dishId", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishId: number = Number(req.params["dishId"]);
    const dishName: string = req.body["name"];
    const dishDescription: string = req.body["description"];
    const dishPrice: number = req.body["price"];

    try {
        // Validations
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }
        
        if (!await doesDishExist(dishId)) {
            throw new ReferenceError("Given dish ID does not exists within the database");
        }

        if (!await doesDishBelongToRestaurant(dishId, restaurantId)) {
            throw new ReferenceError("Given dish ID is not assigned to given restaurant ID");
        }

        await updateDish(dishId, dishName, dishDescription, dishPrice);
        res.sendStatus(200);

    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function deleteDish(dishId: number) {
    await pgClient.query(
        `DELETE FROM dishes
         WHERE id = $1;`,
        [dishId]
    );
}

router.delete("/restaurants/:id/dishes/:dishId", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishId: number = Number(req.params["dishId"]);

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }
        
        if (!await doesDishExist(dishId)) {
            throw new ReferenceError("Given dish ID does not exists within the database");
        }

        if (!await doesDishBelongToRestaurant(dishId, restaurantId)) {
            throw new ReferenceError("Given dish ID is not assigned to given restaurant ID");
        }

        await deleteDish(dishId);
        res.sendStatus(204);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function getDishesByRestaurant(restaurantId: number) {
    const rawRestaurantDishes = await pgClient.query(
        `SELECT id::text, name, description, price
         FROM dishes
         WHERE restaurant_id = $1`,
        [restaurantId]
    );
    
    return rawRestaurantDishes.rows;
}

router.get('/restaurants/:id/dishes', async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);

    try {
        if (!await doesRestaurantExist(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }

        const restaurantDishes = await getDishesByRestaurant(restaurantId);
        console.log(restaurantDishes);
        res.status(200).json(restaurantDishes);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send(err.message);
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

export default router;