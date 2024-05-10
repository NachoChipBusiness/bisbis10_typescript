import { Request, Response, Router } from "express";
import pgClient from "../db/db";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  res.send("Welcome to Express & TypeScript Server");
});

// ################ Verifying Queries ################ //

async function isRestaurantExists(id: number) {
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

async function isDishExists(id: number) {
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

async function isDishBelongsToRestaurant(dishId: number, restaurantId: number) {
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

async function getAllRestaurants() {
    const result = await pgClient.query(
        `SELECT 
            (re.id)::text as "id", 
            re.name as "name", 
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            re.is_kosher as "isKosher",
            COALESCE(JSON_AGG(DISTINCT cu.name) FILTER (WHERE cu.name IS NOT NULL), '[]') as "cuisines"
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
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision AS "averageRating",
            re.is_kosher AS "isKosher",
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
            const cuisine: string = req.query["cuisine"] as string;
            result = await getRestaurantsByCuisine(cuisine);
        }
        res.status(200).json(result.rows);
    } catch (err) {
        console.log(err);
    }
});

async function getRestaurant(restaurantId: number) {
    const rawRestaurantInfo = await pgClient.query(
        `SELECT 
            (re.id)::text as "id", 
            re.name as "name", 
            COALESCE(ROUND(AVG(rating)::numeric, 2), -1)::double precision as "averageRating",
            re.is_kosher as "isKosher",
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
        if (!await isRestaurantExists(restaurantId)) {
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

async function addCuisine(cuisine: string): Promise<number> {
    let rawCuisineId =  await pgClient.query(
        `INSERT INTO cuisines (name) VALUES
            ($1)
         ON CONFLICT (name) DO NOTHING
         RETURNING id;`,
        [cuisine]
    );

    if (rawCuisineId.rows.length === 0) {
        // This is a sign that the cuisine is already exists within the database
        rawCuisineId = await pgClient.query(
            `SELECT id
             FROM cuisines
             WHERE name = $1;`,
            [cuisine]
        );
    }

    return rawCuisineId.rows[0].id;
}

async function addRestaurantCuisines(restaurantId: number, cuisines: Array<string>) {
    for ( let cuisine of cuisines ) {
        let cuisineId: number = await addCuisine(cuisine);

        await pgClient.query(
            `INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id) VALUES
                ($1, $2)
             ON CONFLICT (restaurant_id, cuisine_id) DO NOTHING;`,
            [restaurantId, cuisineId]
        );
    }
}

async function addRestaurant(name: string, isKosher: boolean, cuisines: Array<string>) {
    const rawRestaurantId = await pgClient.query(
        `INSERT INTO restaurants (name, is_kosher) VALUES
            ($1, $2)
         RETURNING id;`,
        [name, String(isKosher)] // The placeholders need to be of the same <any> type in order to get approved by typescript
    );
    
    let restaurantId: number = rawRestaurantId.rows[0].id;

    await addRestaurantCuisines(restaurantId, cuisines);
}

// Add a restaurant
router.post("/restaurants", async (req: Request, res: Response) => {
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: Array<string> = req.body["cuisines"];

    try {
        await addRestaurant(restaurantName, restaurantIsKosher, restaurantCuisines);
        res.sendStatus(201);
    } catch (err) {
        console.log(err);
        res.sendStatus(400);
    }
});

async function updateRestaurant(restaurantId: number, name?: string, isKosher?: boolean, cuisines?: Array<string>) {
    if (name !== undefined) {
        await pgClient.query(
            `UPDATE restaurants
             SET name = $2
             WHERE id = $1;`,
            [String(restaurantId), name] // The placeholders need to be of the same <any> type in order to get approved by typescript
        );
    }

    if (isKosher !== undefined) {
        await pgClient.query(
            `UPDATE restaurants
             SET is_kosher = $2
             WHERE id = $1;`,
            [String(restaurantId), String(isKosher)] // The placeholders need to be of the same <any> type in order to get approved by typescript
        );
    }

    if (cuisines !== undefined) {
        // Delete all existing cuisines with the relevant restaurant
        await pgClient.query(
            `DELETE FROM restaurant_cuisines re_cu
             WHERE re_cu.restaurant_id = $1;`,
            [restaurantId]
        );

        await addRestaurantCuisines(restaurantId, cuisines);
    }
}

router.put("/restaurants/:id", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const restaurantName: string = req.body["name"];
    const restaurantIsKosher: boolean = req.body["isKosher"];
    const restaurantCuisines: Array<string> = req.body["cuisines"];

    try {
        if (!await isRestaurantExists(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
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
        if (!await isRestaurantExists(restaurantId)) {
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
        if (!await isRestaurantExists(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
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

async function updateDish(dishId: number, name?: string, description?: string, price?: number) {
    if (name !== undefined) {
        await pgClient.query(
            `UPDATE dishes
             SET name = $2
             WHERE id = $1;`,
            [String(dishId), name] // The placeholders need to be of the same <any> type in order to get approved by typescript
        );
    }

    if (description !== undefined) {
        await pgClient.query(
            `UPDATE dishes
             SET description = $2
             WHERE id = $1;`,
            [String(dishId), description] // The placeholders need to be of the same <any> type in order to get approved by typescript
        );
    }

    if (price !== undefined) {
        await pgClient.query(
            `UPDATE dishes
             SET price = $2
             WHERE id = $1;`,
            [dishId, price]
        );
    }
}

router.put("/restaurants/:id/dishes/:dishId", async (req: Request, res: Response) => {
    const restaurantId: number = Number(req.params["id"]);
    const dishId: number = Number(req.params["dishId"]);
    const dishName: string = req.body["name"];
    const dishDescription: string = req.body["description"];
    const dishPrice: number = req.body["price"];

    try {
        // Validations
        if (!await isRestaurantExists(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }
        
        if (!await isDishExists(dishId)) {
            throw new ReferenceError("Given dish ID does not exists within the database");
        }

        if (!await isDishBelongsToRestaurant(dishId, restaurantId)) {
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
        if (!await isRestaurantExists(restaurantId)) {
            throw new ReferenceError("Given restaurant ID does not exists within the database");
        }
        
        if (!await isDishExists(dishId)) {
            throw new ReferenceError("Given dish ID does not exists within the database");
        }

        if (!await isDishBelongsToRestaurant(dishId, restaurantId)) {
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
        if (!await isRestaurantExists(restaurantId)) {
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