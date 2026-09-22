"""Starter set of canonical ingredients, seeded at startup like `seed_admin`.

Two jobs. First, it gives `Ingredient.category` real values from day one, so pushing a
recipe to a grocery list can file things under "Produce" and "Meat" instead of dumping
everything in one bucket. Second, it marks the staples — the things every kitchen has —
so a recipe isn't reported as unmakeable because you're theoretically out of salt.

This is a starting point, not a closed list: anything a recipe mentions that isn't here
gets created on the fly by `app.ingredients.resolve(create=True)`, just without a
category until someone sets one.
"""

from sqlalchemy.orm import Session

from app.ingredients import normalize
from app.models import Ingredient, IngredientAlias

# Category names double as grocery-list category names, so they read like store aisles.
INGREDIENTS_BY_CATEGORY: dict[str, list[str]] = {
    "Produce": [
        "onion", "red onion", "green onion", "shallot", "garlic", "ginger", "carrot",
        "celery", "potato", "sweet potato", "tomato", "cherry tomato", "lettuce",
        "romaine lettuce", "spinach", "kale", "cabbage", "broccoli", "cauliflower",
        "green bean", "pea", "corn", "bell pepper", "red bell pepper", "green bell pepper",
        "jalapeno", "cucumber", "zucchini", "squash", "mushroom", "avocado", "asparagus",
        "brussels sprout", "eggplant", "lemon", "lime", "orange", "apple", "banana",
        "strawberry", "blueberry", "raspberry", "grape", "pineapple", "mango", "peach",
        "pear", "cilantro", "parsley", "basil", "mint", "rosemary", "thyme", "dill",
    ],
    "Meat & Seafood": [
        "chicken breast", "chicken thigh", "chicken wing", "whole chicken",
        "ground chicken", "ground turkey", "turkey breast", "ground beef", "steak",
        "sirloin", "ribeye", "chuck roast", "beef stew meat", "pork chop", "pork loin",
        "pork shoulder", "ground pork", "bacon", "sausage", "italian sausage", "ham",
        "salmon", "tilapia", "cod", "tuna", "shrimp", "scallop", "crab",
    ],
    "Dairy & Eggs": [
        "milk", "whole milk", "buttermilk", "heavy cream", "half and half", "sour cream",
        "yogurt", "greek yogurt", "butter", "unsalted butter", "cream cheese",
        "cheddar cheese", "mozzarella cheese", "parmesan cheese", "feta cheese",
        "monterey jack cheese", "swiss cheese", "egg", "provolone cheese",
        "creme fraiche", "ricotta cheese", "cottage cheese",
    ],
    "Bakery": [
        "bread", "white bread", "wheat bread", "sourdough bread", "bagel", "tortilla",
        "flour tortilla", "corn tortilla", "hamburger bun", "hot dog bun", "pita bread",
        "naan", "dinner roll", "english muffin",
    ],
    "Pantry": [
        "rice", "white rice", "brown rice", "pasta", "spaghetti", "penne", "macaroni",
        "egg noodle", "lasagna noodle", "quinoa", "couscous", "oat", "rolled oat",
        "black bean", "kidney bean", "pinto bean", "chickpea", "lentil", "refried bean",
        "canned tomato", "tomato sauce", "tomato paste", "chicken broth",
        "beef broth", "vegetable broth", "coconut milk", "peanut butter", "jelly", "honey",
        "maple syrup", "soy sauce", "worcestershire sauce", "hot sauce", "ketchup",
        "mustard", "dijon mustard", "mayonnaise", "salsa", "vinegar", "balsamic vinegar",
        "apple cider vinegar", "olive oil", "vegetable oil", "canola oil", "sesame oil",
        "cooking spray", "breadcrumb", "panko breadcrumb", "cornstarch",
        "chicken stock", "barbecue sauce", "ranch dressing", "tomato puree",
    ],
    "Baking": [
        "all purpose flour", "bread flour", "sugar", "brown sugar", "powdered sugar",
        "baking soda", "baking powder", "yeast", "vanilla extract", "cocoa powder",
        "chocolate chip", "sweetened condensed milk", "evaporated milk", "shortening",
        "molasses", "cornmeal",
    ],
    "Spices": [
        "salt", "kosher salt", "black pepper", "garlic powder", "onion powder", "paprika",
        "smoked paprika", "chili powder", "cumin", "coriander", "oregano", "dried basil",
        "dried thyme", "dried rosemary", "bay leaf", "cinnamon", "nutmeg", "ginger powder",
        "cayenne pepper", "red pepper flake", "italian seasoning", "curry powder",
        "turmeric", "taco seasoning", "everything bagel seasoning",
    ],
    "Frozen": [
        "frozen pea", "frozen corn", "frozen broccoli", "frozen spinach",
        "frozen berry", "frozen french fry", "ice cream", "frozen pizza", "puff pastry",
        "pie crust",
    ],
    "Beverages": [
        "water", "coffee", "tea", "orange juice", "apple juice", "white wine", "red wine",
        "beer", "chicken bouillon", "club soda",
    ],
}

# Assumed to be in the house. These never count as "missing" when ranking recipes,
# which is what keeps "salt and pepper to taste" from making dinner look impossible.
# A starting point only: this is applied when an ingredient row is first created and
# never again, so editing it won't change a database that has already booted. The live
# list is the Staples section on /pantry.
STAPLES = {
    "salt", "kosher salt", "black pepper", "water", "olive oil", "vegetable oil",
    "canola oil", "cooking spray", "sugar", "all purpose flour", "butter",
    "unsalted butter", "garlic powder", "onion powder", "baking soda", "baking powder",
    "vanilla extract", "cinnamon", "paprika", "oregano", "dried basil", "dried thyme",
    "italian seasoning", "bay leaf", "cumin", "chili powder", "red pepper flake",
    "vinegar", "soy sauce", "honey", "ketchup", "mustard", "mayonnaise", "cornstarch",
    "brown sugar", "egg", "milk",
}

# Same ingredient, different name on the package or in the recipe.
ALIASES: dict[str, str] = {
    "scallion": "green onion",
    "spring onion": "green onion",
    "garbanzo bean": "chickpea",
    "coriander leaf": "cilantro",
    "aubergine": "eggplant",
    "courgette": "zucchini",
    "rocket": "lettuce",
    "capsicum": "bell pepper",
    "minced beef": "ground beef",
    "hamburger meat": "ground beef",
    "hamburger": "ground beef",
    "confectioners sugar": "powdered sugar",
    "icing sugar": "powdered sugar",
    "caster sugar": "sugar",
    "granulated sugar": "sugar",
    "plain flour": "all purpose flour",
    "flour": "all purpose flour",
    "double cream": "heavy cream",
    "whipping cream": "heavy cream",
    "heavy whipping cream": "heavy cream",
    "coriander seed": "coriander",
    "chile powder": "chili powder",
    "chilli powder": "chili powder",
    "stock": "chicken broth",
    "prawn": "shrimp",
    "cheddar": "cheddar cheese",
    "mozzarella": "mozzarella cheese",
    "parmesan": "parmesan cheese",
    "parmigiano reggiano": "parmesan cheese",
    "pepper": "black pepper",
    "cracked black pepper": "black pepper",
    "sea salt": "salt",
    "table salt": "salt",
    "extra virgin olive oil": "olive oil",
    "evoo": "olive oil",
    "spaghetti noodle": "spaghetti",
    "noodle": "pasta",
    "greek style yogurt": "greek yogurt",
    "bicarbonate of soda": "baking soda",
    # British and American spellings of the same thing, plus compound names the model
    # returns verbatim from a recipe.
    "lasagne sheet": "lasagna noodle",
    "lasagna sheet": "lasagna noodle",
    "lasagne noodle": "lasagna noodle",
    "bread crumb": "breadcrumb",
    "panko bread crumb": "panko breadcrumb",
    "dried breadcrumb": "breadcrumb",
    "beef mince": "ground beef",
    "pork mince": "ground pork",
    "chicken mince": "ground chicken",
    "streaky bacon": "bacon",
    "smoked streaky bacon": "bacon",
    "natural yogurt": "yogurt",
    "spring greens": "kale",
    "tomato pure": "tomato puree",
    # "salt and pepper to taste" comes back as one canonical name. It's always a staple
    # and always optional, so folding it onto salt keeps it out of "missing ingredients"
    # instead of creating a junk row per recipe.
    "salt and pepper": "salt",
    "semi sweet chocolate chip": "chocolate chip",
    "semisweet chocolate chip": "chocolate chip",
    "dark chocolate chip": "chocolate chip",
    "milk chocolate chip": "chocolate chip",
    "whole peeled tomato": "canned tomato",
    "petite diced tomato": "canned tomato",
}


def seed_ingredients(db: Session) -> None:
    """Insert any missing canonical ingredients and aliases. Safe to run on every boot.

    Only ever adds rows. An ingredient whose category or staple flag was changed by hand
    keeps that change, and a name that has since been deleted stays deleted rather than
    reappearing on the next restart.
    """
    existing_keys = {key for (key,) in db.query(Ingredient.norm_key).all()}
    added_any = False

    for category, names in INGREDIENTS_BY_CATEGORY.items():
        for name in names:
            key = normalize(name)
            if not key or key in existing_keys:
                continue
            db.add(
                Ingredient(
                    name=name,
                    norm_key=key,
                    category=category,
                    is_staple=name in STAPLES,
                )
            )
            existing_keys.add(key)
            added_any = True

    if added_any:
        db.flush()

    # Aliases are resolved after the ingredients exist, so a target added in this same
    # pass is already available to point at.
    by_key = {
        key: ingredient_id
        for ingredient_id, key in db.query(Ingredient.id, Ingredient.norm_key).all()
    }
    existing_alias_keys = {key for (key,) in db.query(IngredientAlias.norm_key).all()}

    for alias_name, target_name in ALIASES.items():
        alias_key = normalize(alias_name)
        target_key = normalize(target_name)
        target_id = by_key.get(target_key)
        # Skip an alias whose key collides with a real ingredient — the real one wins.
        if not alias_key or target_id is None or alias_key in existing_alias_keys:
            continue
        if alias_key in by_key:
            continue
        db.add(IngredientAlias(ingredient_id=target_id, norm_key=alias_key))
        existing_alias_keys.add(alias_key)

    db.commit()
