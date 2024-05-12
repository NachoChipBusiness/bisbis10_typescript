import { Request, Response, Router } from "express";
import pgGetClient from "../db/db";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Express & TypeScript Server");
});

// ################ Verifying Queries ################ //
// Verify that:
// 1. the restaurant exists
async function restaurantVerifications(restaurantId: number) {
    const result = await pgGetClient().query(
        `WITH verification_queries AS (
            SELECT 
                'does_restaurant_id_exist' AS "query", 
                EXISTS (
                    SELECT 1
                    FROM restaurants
                    WHERE id = $1
                ) AS "status",
                'Restaurant ID does not exist' AS "on_fail_status"
        )
        SELECT 
            query, 
            status, 
            CASE
                WHEN status = false THEN on_fail_status
                ELSE 'verification passed!'
            END AS "status_message"
        FROM verification_queries;`,
        [restaurantId]
    );

    return result.rows;
}

// Verify that:
// 1. the restaurant exists
// 2. the dish exists
// 3. the dish is registered to the restaurant
async function restaurantAndDishVerifications(restaurantId: number, dishId: number) {
    const result = await pgGetClient().query(
        `WITH verification_queries AS (
            SELECT 
                'does_restaurant_id_exist' AS "query", 
                EXISTS (
                    SELECT 1
                    FROM restaurants
                    WHERE id = $1
                ) AS "status",
                'Restaurant ID does not exist' AS "on_fail_status"
            UNION ALL
            SELECT 
                'does_dish_id_exist' AS "query", 
                EXISTS (
                    SELECT 1
                    FROM dishes
                    WHERE id = $2
                ) AS "status",
                'Dish ID does not exist' AS "on_fail_status"
            UNION ALL
            SELECT 
                'does_dish_belong_to_restaurant' AS "query", 
                EXISTS (
                    SELECT 1
                    FROM dishes
                    WHERE id = $2 AND restaurant_id = $1
                ) AS "status",
                'Dish ID is not assigned to given restaurant' AS "on_fail_status"
        )
        SELECT 
            query, 
            status, 
            CASE
                WHEN status = false THEN on_fail_status
                ELSE 'verification passed!'
            END AS "status_message"
        FROM verification_queries;`,
        [restaurantId, dishId]
    );

    return result.rows;
}

// ################ Restaurants APIs ################ //

// Returns an object containing an array of json objects
// each contains a reataurant data as define in the excersice for "Get all restaurants".
// A restaurant without any rating receives a -1 rating
async function getAllRestaurants() {
    const result = await pgGetClient().query(
        `SELECT 
            (re.id)::text AS "id", 
            re.name AS "name", 
            
            -- Get the average ratings of each restaurant.
            -- -1 if no ratings for the restaurant.
            -- Use ROUND to get only 2 decimals.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that aggregates grouped values into a single list.
            -- FILTER lets you have NULL in case there are no cuisines assigned to the given restaurant
            -- and using the COALESCE an empty list is returned instead.
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') AS "cuisines"
         
         -- These three LEFT JOINs ensure all the existing restaurant IDs will be in the final output
         FROM restaurants re
         LEFT JOIN ratings ON re.id = ratings.restaurant_id
         LEFT JOIN restaurant_cuisines re_cu ON re.id = re_cu.restaurant_id
         LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
         GROUP BY re.id;`
    );

    return result.rows;
}
async function getRestaurantsByCuisine(cuisine: string) {
    const result = await pgGetClient().query(
        `SELECT 
            (re.id)::text AS "id", 
            re.name AS "name", 
            
            -- Get the average ratings of each restaurant.
            -- -1 if no ratings for the restaurant.
            -- Use ROUND to get only 2 decimals.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that aggregates grouped values into a single list.
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

    return result.rows;
}

router.get("/restaurants", async (req: Request, res: Response) => {
    try {
        let restaurantsInfo;
       
        if (req.query.constructor === Object && Object.keys(req.query).length === 0) {
            // No request params (after a '?' in the URL) - return all restaurants
            restaurantsInfo = await getAllRestaurants();
        } else {
            if (req.query["cuisine"] === undefined) {
                throw new Error("Bad Request: no \"cuisine\" specified in query.")
            }
            const cuisine: string = req.query["cuisine"] as string;
            restaurantsInfo = await getRestaurantsByCuisine(cuisine);
        }
        res.status(200).json(restaurantsInfo);
    } catch (err) {
        if (err instanceof Error) {
            res.status(400).send({error: err.message});
        } else {
            console.log(err);
            res.status(400).send(err);
        }
    }
});

async function getRestaurant(restaurantId: number) {
    const rawRestaurantInfo = await pgGetClient().query(
        `SELECT 
            (re.id)::text as "id", 
            re.name as "name", 
            
            -- Get the average ratings of each restaurant.
            -- -1 if no ratings for the restaurant.
            -- Use ROUND to get only 2 decimals.
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            
            re.is_kosher as "isKosher",
            
            -- JSON_AGG is a Postgresql function that aggregates grouped values into a single list.
            -- FILTER lets you have NULL in case there are no cuisines assigned to the given restaurant
            -- and using the COALESCE an empty list is returned instead.
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') as "cuisines"
         
        -- These three LEFT JOINs ensure all the existing restaurant IDs will be in the final output
        FROM restaurants re
        LEFT JOIN ratings ON re.id = ratings.restaurant_id
        LEFT JOIN restaurant_cuisines re_cu ON re.id = re_cu.restaurant_id
        LEFT JOIN cuisines cu ON re_cu.cuisine_id = cu.id
        WHERE re.id = $1
        GROUP BY re.id;`,
        [restaurantId]
    );

    let restaurantInfo = rawRestaurantInfo.rows[0];

    // In this service we return the dishes in addition to all other info
    const rawRestaurantDishes = await pgGetClient().query(
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
        const verificationResults = await restaurantVerifications(restaurantId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        const restaurantInfo = await getRestaurant(restaurantId);
        res.status(200).json(restaurantInfo);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function addRestaurant(name: string, isKosher: boolean, cuisines: string[]) {
    const addRestaurantQueryString = `INSERT INTO restaurants (name, is_kosher) VALUES ($1, $2) RETURNING id`;
    const cuisinesValues = cuisines.map((cuisine, index) => `($${index + 3})`).join(', ');
    // There is an edge case where no cuisines are given, (i.e. cuisines is an empty string[]), in this case the query is a bit different and was meant to return a table with no rows but a column named "id".
    const addCuisinesQueryString = (cuisinesValues !== '') ? `INSERT INTO cuisines (name) VALUES ${cuisinesValues} ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id` : `SELECT id FROM cuisines WHERE false`;
    
    // Using string concatenation, 3+ queries are unified to a single query!
    await pgGetClient().query(
        `WITH restaurant AS (${addRestaurantQueryString}),
        restaurant_cuisines AS (${addCuisinesQueryString})

        -- Using recieved information from restaurant and restaurant_cuisines nested-queries
        -- to achieve the third INSERT INTO query.
        INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
        SELECT re.id, cu.id
        FROM restaurant re, restaurant_cuisines cu;`,
        [name, String(isKosher), ...cuisines]
    )
}

router.post("/restaurants", async (req: Request, res: Response) => {
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: string[] = req.body["cuisines"];

    try {
        // In the post request all three Request Body Properties are mandatory
        if (restaurantName === undefined || restaurantIsKosher === undefined || restaurantCuisines === undefined) {
            throw new Error("Bad Request Body")
        }

        await addRestaurant(restaurantName, restaurantIsKosher, restaurantCuisines);
        res.sendStatus(201);
    } catch (err) {
        if (err instanceof Error) {
            res.status(400).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function updateRestaurant(restaurantId: number, name: string, isKosher: boolean, cuisines: string[]) {       
    try {
        await pgGetClient().query(`BEGIN`);
        if (name !== undefined) {
            await pgGetClient().query(`UPDATE restaurants SET name = $2 WHERE id = $1`, [String(restaurantId), name])
        }
        if (isKosher !== undefined) {
            await pgGetClient().query(`UPDATE restaurants SET is_kosher = $2 WHERE id = $1`), [String(restaurantId), String(isKosher)]
        }
        if (cuisines != undefined) {
            await pgGetClient().query(`DELETE FROM restaurant_cuisines re_cu WHERE re_cu.restaurant_id = $1`, [restaurantId]);
            
            const cuisinesValues = cuisines.map((cuisine, index) => `($${index + 2})`).join(', ');
            // There is an edge case where no cuisines are given, (aka cuisines is an empty string[]), in this case the query is a bit different and was meant to return a table with no rows but a column named "id".
            const addCuisinesQueryString = (cuisinesValues !== '') ? `INSERT INTO cuisines (name) VALUES ${cuisinesValues} ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id` : `SELECT id FROM cuisines WHERE false`;
            await pgGetClient().query(
                `WITH restaurant_cuisines AS (${addCuisinesQueryString})
                -- Using recieved information from restaurant and restaurant_cuisines nested-queries
                -- to achieve the third INSERT INTO query.
                INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id)
                SELECT $1 AS restaurant_id, cu.id
                FROM restaurant_cuisines cu;`,
            [String(restaurantId), ...cuisines])
        }
        await pgGetClient().query(`COMMIT`);
    } catch (err) {
        await pgGetClient().query('ROLLBACK');
        throw err;
    }
}

// Restaurant update
router.put("/restaurants/:id", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: string[] = req.body["cuisines"];

    try {
        // This verification will ensure that the updateRestaurant will get at least one parameter (from the optional ones)
        // that is not 'undefined'.
        if (restaurantName === undefined && restaurantIsKosher === undefined && restaurantCuisines === undefined) {
            throw new Error("Bad Request Body. At least one field must be provided.")
        }

        const verificationResults = await restaurantVerifications(restaurantId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        await updateRestaurant(restaurantId, restaurantName, restaurantIsKosher, restaurantCuisines);
        res.sendStatus(200);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else if (err instanceof Error) {
            res.status(400).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function deleteRestaurant(restaurantId: number) {
    // No need to take care of back-references because we have "ON DELETE CASCADE" in the DB schema
    await pgGetClient().query(
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
    await pgGetClient().query(
        `INSERT INTO ratings (restaurant_id, rating) VALUES
            ($1, $2);`,
        [restaurantId, rating]
    )
}

router.post("/ratings", async (req: Request, res: Response) => {
    const restaurantId: number = req.body["restaurantId"];
    const restaurantRating: number = req.body["rating"];

    try {
        const verificationResults = await restaurantVerifications(restaurantId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        await addRating(restaurantId, restaurantRating);
        res.sendStatus(200);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).json({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

// ################ Dishes APIs ################ //

async function addDish(restaurantId: number, name: string, description: string, price: number) {
    await pgGetClient().query(
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
        if (dishName === undefined || dishDescription === undefined || dishPrice === undefined) {
            throw new Error("Bad Request Body. All fields must be provided")
        }
        
        const verificationResults = await restaurantVerifications(restaurantId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        await addDish(restaurantId, dishName, dishDescription, dishPrice);
        res.sendStatus(201);
        
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else if (err instanceof Error) {
            res.status(400).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function updateDish(dishId: number, name: string, description: string, price: number) {
    try {
        await pgGetClient().query(`BEGIN`);
        if (name !== undefined) {
            await pgGetClient().query(`UPDATE dishes SET name = $2 WHERE id = $1`, [String(dishId), name]);
        }
        if (description !== undefined) {
            await pgGetClient().query(`UPDATE dishes SET description = $2 WHERE id = $1`, [String(dishId), description]);
        }
        if (price !== undefined) {
            await pgGetClient().query(`UPDATE dishes SET price = $2 WHERE id = $1`, [dishId, price]);
        }
        await pgGetClient().query(`COMMIT`);
    } catch (err) {
        await pgGetClient().query('ROLLBACK');
        throw err;
    }
}

router.put("/restaurants/:id/dishes/:dishId", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishId: number = Number(req.params["dishId"]);
    const dishName: string = req.body["name"];
    const dishDescription: string = req.body["description"];
    const dishPrice: number = req.body["price"];

    try {
        const verificationResults = await restaurantAndDishVerifications(restaurantId, dishId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        await updateDish(dishId, dishName, dishDescription, dishPrice);
        res.sendStatus(200);

    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function deleteDish(dishId: number) {
    await pgGetClient().query(
        `DELETE FROM dishes
         WHERE id = $1;`,
        [dishId]
    );
}

router.delete("/restaurants/:id/dishes/:dishId", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishId: number = Number(req.params["dishId"]);

    try {
        const verificationResults = await restaurantAndDishVerifications(restaurantId, dishId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        await deleteDish(dishId);
        res.sendStatus(204);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

async function getDishesByRestaurant(restaurantId: number) {
    const rawRestaurantDishes = await pgGetClient().query(
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
        const verificationResults = await restaurantVerifications(restaurantId);
        for (let verification of verificationResults) {
            if (!verification.status) {
                throw new ReferenceError(verification.status_message);
            }
        }

        const restaurantDishes = await getDishesByRestaurant(restaurantId);
        console.log(restaurantDishes);
        res.status(200).json(restaurantDishes);
    } catch (err) {
        if (err instanceof ReferenceError) {
            res.status(404).send({error: err.message});
        } else {
            console.log(err);
            res.sendStatus(400);
        }
    }
});

export default router;